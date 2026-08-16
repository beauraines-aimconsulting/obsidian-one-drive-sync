/**
 * OneDrive client for uploading files via Microsoft Graph API.
 */

import * as fs from 'fs';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const SMALL_FILE_LIMIT = 4 * 1024 * 1024; // 4MB
const UPLOAD_CHUNK_SIZE = 320 * 1024 * 10; // 3.2MB chunks for upload sessions

export interface UploadResult {
  success: boolean;
  filepath: string;
  oneDrivePath: string;
  itemId?: string;
  error?: string;
  size?: number;
}

export interface OneDriveClientOptions {
  targetFolder: string;
  accessToken: string;
}

export class OneDriveClient {
  private targetFolder: string;
  private accessToken: string;

  constructor(options: OneDriveClientOptions) {
    this.targetFolder = options.targetFolder.replace(/^\/+|\/+$/g, '');
    this.accessToken = options.accessToken;
  }

  /**
   * Upload a file from the local filesystem to OneDrive.
   * Automatically uses simple upload for small files and upload sessions for large ones.
   */
  async uploadFile(
    localPath: string,
    relativePath: string
  ): Promise<UploadResult> {
    const oneDrivePath = this.buildOneDrivePath(relativePath);

    try {
      const stats = fs.statSync(localPath);

      if (stats.size > SMALL_FILE_LIMIT) {
        return this.uploadLargeFile(localPath, oneDrivePath, stats.size);
      }

      return this.uploadSmallFile(localPath, oneDrivePath);
    } catch (error) {
      return {
        success: false,
        filepath: localPath,
        oneDrivePath,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Upload file content directly (without reading from disk).
   */
  async uploadContent(
    content: string,
    relativePath: string
  ): Promise<UploadResult> {
    const oneDrivePath = this.buildOneDrivePath(relativePath);

    try {
      const encodedPath = this.encodePath(oneDrivePath);
      const url = `${GRAPH_BASE}/me/drive/root:/${encodedPath}:/content`;

      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'text/markdown',
        },
        body: content,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          filepath: relativePath,
          oneDrivePath,
          error: this.parseGraphError(errorBody, response.status),
        };
      }

      const data = (await response.json()) as { id: string; size: number };
      return {
        success: true,
        filepath: relativePath,
        oneDrivePath,
        itemId: data.id,
        size: data.size,
      };
    } catch (error) {
      return {
        success: false,
        filepath: relativePath,
        oneDrivePath,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Delete a file from OneDrive by its item ID.
   */
  async deleteFile(itemId: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${GRAPH_BASE}/me/drive/items/${itemId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${this.accessToken}` },
        }
      );
      return response.ok || response.status === 404;
    } catch {
      return false;
    }
  }

  /**
   * Check if a file exists on OneDrive and get its metadata.
   */
  async getFileMetadata(
    relativePath: string
  ): Promise<{ exists: boolean; itemId?: string; size?: number; lastModified?: string }> {
    const oneDrivePath = this.buildOneDrivePath(relativePath);
    const encodedPath = this.encodePath(oneDrivePath);
    const url = `${GRAPH_BASE}/me/drive/root:/${encodedPath}`;

    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      if (response.status === 404) {
        return { exists: false };
      }

      if (!response.ok) {
        return { exists: false };
      }

      const data = (await response.json()) as {
        id: string;
        size: number;
        lastModifiedDateTime: string;
      };
      return {
        exists: true,
        itemId: data.id,
        size: data.size,
        lastModified: data.lastModifiedDateTime,
      };
    } catch {
      return { exists: false };
    }
  }

  private async uploadSmallFile(
    localPath: string,
    oneDrivePath: string
  ): Promise<UploadResult> {
    const content = fs.readFileSync(localPath);
    const encodedPath = this.encodePath(oneDrivePath);
    const url = `${GRAPH_BASE}/me/drive/root:/${encodedPath}:/content`;

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/octet-stream',
      },
      body: content,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return {
        success: false,
        filepath: localPath,
        oneDrivePath,
        error: this.parseGraphError(errorBody, response.status),
      };
    }

    const data = (await response.json()) as { id: string; size: number };
    return {
      success: true,
      filepath: localPath,
      oneDrivePath,
      itemId: data.id,
      size: data.size,
    };
  }

  private async uploadLargeFile(
    localPath: string,
    oneDrivePath: string,
    fileSize: number
  ): Promise<UploadResult> {
    const encodedPath = this.encodePath(oneDrivePath);
    const sessionUrl = `${GRAPH_BASE}/me/drive/root:/${encodedPath}:/createUploadSession`;

    // Create upload session
    const sessionResponse = await fetch(sessionUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        item: { '@microsoft.graph.conflictBehavior': 'replace' },
      }),
    });

    if (!sessionResponse.ok) {
      const errorBody = await sessionResponse.text();
      return {
        success: false,
        filepath: localPath,
        oneDrivePath,
        error: this.parseGraphError(errorBody, sessionResponse.status),
      };
    }

    const session = (await sessionResponse.json()) as { uploadUrl: string };
    const uploadUrl = session.uploadUrl;

    // Upload in chunks
    const fd = fs.openSync(localPath, 'r');
    let offset = 0;

    try {
      while (offset < fileSize) {
        const chunkSize = Math.min(UPLOAD_CHUNK_SIZE, fileSize - offset);
        const buffer = Buffer.alloc(chunkSize);
        fs.readSync(fd, buffer, 0, chunkSize, offset);

        const rangeEnd = offset + chunkSize - 1;
        const chunkResponse = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Length': String(chunkSize),
            'Content-Range': `bytes ${offset}-${rangeEnd}/${fileSize}`,
          },
          body: buffer,
        });

        if (!chunkResponse.ok && chunkResponse.status !== 202) {
          const errorBody = await chunkResponse.text();
          return {
            success: false,
            filepath: localPath,
            oneDrivePath,
            error: this.parseGraphError(errorBody, chunkResponse.status),
          };
        }

        // Final chunk returns the item
        if (chunkResponse.status === 200 || chunkResponse.status === 201) {
          const data = (await chunkResponse.json()) as {
            id: string;
            size: number;
          };
          return {
            success: true,
            filepath: localPath,
            oneDrivePath,
            itemId: data.id,
            size: data.size,
          };
        }

        offset += chunkSize;
      }
    } finally {
      fs.closeSync(fd);
    }

    return {
      success: false,
      filepath: localPath,
      oneDrivePath,
      error: 'Upload session completed without final response',
    };
  }

  private buildOneDrivePath(relativePath: string): string {
    // Normalize path separators and combine with target folder
    const normalized = relativePath.replace(/\\/g, '/');
    return `${this.targetFolder}/${normalized}`;
  }

  private encodePath(oneDrivePath: string): string {
    // Encode each path segment individually
    return oneDrivePath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
  }

  private parseGraphError(body: string, statusCode: number): string {
    try {
      const parsed = JSON.parse(body) as {
        error?: { code?: string; message?: string };
      };
      if (parsed.error) {
        return `[${statusCode}] ${parsed.error.code}: ${parsed.error.message}`;
      }
    } catch {
      // Not JSON
    }
    return `[${statusCode}] ${body.slice(0, 200)}`;
  }
}
