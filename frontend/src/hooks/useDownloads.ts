import { useEffect, useRef, useState } from "react";
import { useDownloadsStore } from "../store/downloads";
import { useAccounts } from "./useAccounts";
import { accountHash } from "../utils/account";

export function useDownloads() {
  const {
    tasks,
    loading,
    setAccountHashes,
    fetchTasks,
    startDownload,
    pauseDownload,
    resumeDownload,
    deleteDownload,
  } = useDownloadsStore();
  const { accounts } = useAccounts();
  const hashesRef = useRef("");
  const [hashToEmail, setHashToEmail] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 计算各账号哈希，顺序与 accounts 保持一致
      const hashes = await Promise.all(accounts.map((a) => accountHash(a)));
      // 先 slice 再 sort，避免修改原始 hashes 数组
      const key = hashes.slice().sort().join(",");
      if (cancelled || key === hashesRef.current) return;
      hashesRef.current = key;

      const map: Record<string, string> = {};
      for (let i = 0; i < accounts.length; i++) {
        // 此时 hashes[i] 与 accounts[i] 一一对应
        map[hashes[i]] = accounts[i].email;
      }
      setHashToEmail(map);

      setAccountHashes(hashes);
      // 哈希设置完成后立即拉取一次，保证首次进入页面即展示下载列表
      fetchTasks();
    })();
    return () => {
      cancelled = true;
    };
  }, [accounts, setAccountHashes, fetchTasks]);

  return {
    tasks,
    loading,
    hashToEmail,
    fetchTasks,
    startDownload,
    pauseDownload,
    resumeDownload,
    deleteDownload,
  };
}
