export interface Software {
  id: number;
  bundleID: string;
  name: string;
  version: string;
  price?: number;
  artistName: string;
  sellerName: string;
  description: string;
  averageUserRating: number;
  userRatingCount: number;
  artworkUrl: string;
  screenshotUrls: string[];
  minimumOsVersion: string;
  fileSizeBytes?: string;
  releaseDate: string;
  releaseNotes?: string;
  formattedPrice?: string;
  primaryGenreName: string;
}

export interface Sinf {
  id: number;
  sinf: string; // base64 编码的 DRM 签名
}

export interface DownloadTask {
  id: string;
  software: Software;
  accountHash: string;
  downloadURL: string;
  sinfs: Sinf[];
  iTunesMetadata?: string;
  status:
    | "pending"
    | "downloading"
    | "paused"
    | "injecting"
    | "completed"
    | "failed";
  progress: number;
  speed: string;
  error?: string;
  /** 稳定的机器可读错误码，前端据此展示本地化文案（如 "timeout"、"too-large"） */
  errorCode?: string;
  /** 成品文件大小（字节），任务完成时记录，避免列表接口重复 stat */
  fileSize?: number;
  filePath?: string;
  createdAt: string;
}

export interface PackageInfo {
  id: string;
  software: Software;
  accountHash: string;
  filePath: string;
  fileSize: number;
  createdAt: string;
}
