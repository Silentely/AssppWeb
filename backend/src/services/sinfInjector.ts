import { execFile as execFileCb } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import { open as openZip } from "yauzl-promise";
import type { Readable } from "stream";
import bplistParser from "bplist-parser";
import bplistCreator from "bplist-creator";
import plist from "plist";
import type { Sinf } from "../types/index.js";

const execFile = promisify(execFileCb);

interface IpaMetadata {
  bundleName: string;
  manifest: { sinfPaths: string[] } | null;
  info: { bundleExecutable: string } | null;
}

export async function inject(
  sinfs: Sinf[],
  ipaPath: string,
  iTunesMetadata?: string,
): Promise<void> {
  const { bundleName, manifest, info } = await readIpaMetadata(ipaPath);

  // 收集所有需要注入的文件
  const filesToInject: { entryPath: string; data: Buffer }[] = [];

  if (manifest) {
    for (let i = 0; i < manifest.sinfPaths.length; i++) {
      if (i >= sinfs.length) continue;
      const sinfPath = manifest.sinfPaths[i];
      const fullPath = `Payload/${bundleName}.app/${sinfPath}`;
      filesToInject.push({
        entryPath: fullPath,
        data: Buffer.from(sinfs[i].sinf, "base64"),
      });
    }
  } else if (info) {
    if (sinfs.length > 0) {
      const sinfPath = `Payload/${bundleName}.app/SC_Info/${info.bundleExecutable}.sinf`;
      filesToInject.push({
        entryPath: sinfPath,
        data: Buffer.from(sinfs[0].sinf, "base64"),
      });
    }
  } else {
    throw new Error("Could not read manifest or info plist");
  }

  // 若提供了 iTunesMetadata，则注入到 IPA 归档根目录。
  // 前端发送的是 base64 编码的 XML plist，这里转换为二进制 plist，
  // 以匹配 Apple 原生格式（PropertyListSerialization .binary）。
  if (iTunesMetadata) {
    const xmlBuffer = Buffer.from(iTunesMetadata, "base64");
    const xmlString = xmlBuffer.toString("utf-8");
    let metadataBuffer: Buffer;
    try {
      const parsed = plist.parse(xmlString);
      metadataBuffer = bplistCreator(parsed as Record<string, unknown>);
    } catch {
      metadataBuffer = xmlBuffer;
    }
    filesToInject.push({
      entryPath: "iTunesMetadata.plist",
      data: metadataBuffer,
    });
  }

  if (filesToInject.length > 0) {
    await addFilesToZip(ipaPath, filesToInject);
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readIpaMetadata(ipaPath: string): Promise<IpaMetadata> {
  const zip = await openZip(ipaPath);
  try {
    let bundleName: string | null = null;
    let manifestData: Buffer | null = null;
    let infoPlistData: Buffer | null = null;

    for await (const entry of zip) {
      const filename = entry.filename;

      // 从 .app 目录中查找 bundle 名称
      if (
        !bundleName &&
        filename.includes(".app/Info.plist") &&
        !filename.includes("/Watch/")
      ) {
        const components = filename.split("/");
        for (const component of components) {
          if (component.endsWith(".app")) {
            bundleName = component.slice(0, -4);
            break;
          }
        }
      }

      // 读取 Manifest.plist
      if (!manifestData && filename.endsWith(".app/SC_Info/Manifest.plist")) {
        const stream = await entry.openReadStream();
        manifestData = await streamToBuffer(stream);
      }

      // 读取 Info.plist（排除 Watch 应用）
      if (
        !infoPlistData &&
        filename.includes(".app/Info.plist") &&
        !filename.includes("/Watch/")
      ) {
        const stream = await entry.openReadStream();
        infoPlistData = await streamToBuffer(stream);
      }
    }

    if (!bundleName) {
      throw new Error("Could not read bundle name");
    }

    // 解析 manifest
    let manifest: { sinfPaths: string[] } | null = null;
    if (manifestData) {
      const parsed = parsePlistBuffer(manifestData);
      if (parsed) {
        const sinfPaths = parsed["SinfPaths"];
        if (Array.isArray(sinfPaths)) {
          manifest = { sinfPaths: sinfPaths as string[] };
        }
      }
    }

    // 解析 info plist
    let info: { bundleExecutable: string } | null = null;
    if (infoPlistData) {
      const parsed = parsePlistBuffer(infoPlistData);
      if (parsed) {
        const executable = parsed["CFBundleExecutable"];
        if (typeof executable === "string") {
          info = { bundleExecutable: executable };
        }
      }
    }

    return { bundleName, manifest, info };
  } finally {
    await zip.close();
  }
}

async function addFilesToZip(
  ipaPath: string,
  files: { entryPath: string; data: Buffer }[],
): Promise<void> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sinf-"));
  const resolvedTmpDir = path.resolve(tmpDir);
  try {
    // 写入临时目录，保持 ZIP 内部路径结构
    const relativePaths: string[] = [];
    for (const file of files) {
      // 防止从 IPA 解析出的条目路径造成路径穿越
      const fullPath = path.resolve(tmpDir, file.entryPath);
      if (!fullPath.startsWith(resolvedTmpDir + path.sep)) {
        throw new Error(`Path traversal detected in entry: ${file.entryPath}`);
      }
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.promises.writeFile(fullPath, file.data);
      relativePaths.push(file.entryPath);
    }

    // 使用 zip 就地更新归档
    // -0: 不压缩存储（SINF/plist 文件都很小）
    // 归档名后的 "--" 防止文件名被解析为命令行参数
    await execFile("zip", ["-0", ipaPath, "--", ...relativePaths], {
      cwd: tmpDir,
      maxBuffer: 1024 * 1024,
    });
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

function parsePlistBuffer(data: Buffer): Record<string, unknown> | null {
  // 优先尝试二进制 plist
  try {
    const parsed = bplistParser.parseBuffer(data);
    if (parsed && parsed.length > 0) {
      return parsed[0] as Record<string, unknown>;
    }
  } catch {
    // 非二进制 plist，继续尝试 XML
  }

  // 尝试 XML plist
  try {
    const xml = data.toString("utf-8");
    if (xml.includes("<?xml") || xml.includes("<plist")) {
      const parsed = plist.parse(xml);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    }
  } catch {
    // 也不是合法的 XML plist
  }

  return null;
}
