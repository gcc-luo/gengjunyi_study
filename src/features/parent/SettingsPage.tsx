import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../context/AppStore';
import { apiRequest } from '../../lib/api-client';
import { EYE_CARE_STORAGE_KEY, FREE_CHOICE_STORAGE_KEY, writeEyeCarePreference } from '../child/preferences';

type StorageQuota = { usedBytes: string; reservedBytes: string; totalBytes: string; availableBytes: string; usedPercent: number; warningLevel: 'none' | 'warning' | 'critical' };
const readPreference = (key: string, defaultValue = false) => window.localStorage.getItem(key) === null ? defaultValue : window.localStorage.getItem(key) === 'true';
const bytesText = (bytes: string) => `${(Number(bytes) / 1_000_000_000).toFixed(2)} GB`;

export function SettingsPage() {
  const { isRemote } = useAppStore();
  const [freeChoice, setFreeChoice] = useState(() => readPreference(FREE_CHOICE_STORAGE_KEY, true));
  const [eyeCare, setEyeCare] = useState(() => readPreference(EYE_CARE_STORAGE_KEY));
  const quota = useQuery({ queryKey: ['parent', 'storage'], queryFn: () => apiRequest<StorageQuota>('/api/storage'), enabled: isRemote });
  const toggle = (key: string, value: boolean, setValue: (value: boolean) => void) => { setValue(value); if (key === EYE_CARE_STORAGE_KEY) writeEyeCarePreference(value); else window.localStorage.setItem(key, String(value)); };
  const used = quota.data ? Number(quota.data.usedBytes) + Number(quota.data.reservedBytes) : 0;

  return <div className="parent-page"><div className="page-heading"><div><p className="eyebrow">工作台偏好</p><h1>设置</h1><p className="page-subtitle">偏好保存在当前浏览器，视频与家庭数据保存在服务器。</p></div></div><div className="settings-grid">
    <section className="panel"><div className="panel-heading"><div><h2>MinIO 视频存储</h2><p>家庭视频限额 100 GB，预留中的上传也计入容量。</p></div></div><div className="storage-meter"><span className="metric-icon blue">▣</span><div><strong data-testid="storage-size">{quota.isLoading ? '读取中…' : quota.data ? `${bytesText(String(used))} / ${bytesText(quota.data.totalBytes)}` : isRemote ? '暂不可用' : '服务器管理'}</strong><small>{quota.data ? `已使用 ${quota.data.usedPercent.toFixed(1)}% · 可用 ${bytesText(quota.data.availableBytes)}` : '不使用浏览器 localStorage 保存视频'}</small></div></div>{quota.data?.warningLevel !== 'none' && quota.data && <p className="form-error" role="alert">存储空间接近上限，请先删除不再需要的视频。</p>}{quota.error && <p className="form-error" role="alert">无法读取存储空间：{quota.error instanceof Error ? quota.error.message : '请求失败'} <button type="button" onClick={() => void quota.refetch()}>重试</button></p>}</section>
    <section className="panel"><div className="panel-heading"><div><h2>儿童端偏好</h2><p>下次打开儿童端时继续使用。</p></div></div><label className="setting-toggle"><span><strong>允许自由选课</strong><small>儿童可浏览所有已发布课程</small></span><input aria-label="允许自由选课" type="checkbox" checked={freeChoice} onChange={(event) => toggle(FREE_CHOICE_STORAGE_KEY, event.target.checked, setFreeChoice)} /></label><label className="setting-toggle"><span><strong>护眼模式</strong><small>降低儿童端的对比度和亮度</small></span><input aria-label="护眼模式" type="checkbox" checked={eyeCare} onChange={(event) => toggle(EYE_CARE_STORAGE_KEY, event.target.checked, setEyeCare)} /></label></section>
  </div></div>;
}
