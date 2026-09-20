import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../context/AppStore';
import { apiRequest } from '../../lib/api-client';
import { EYE_CARE_STORAGE_KEY, FREE_CHOICE_STORAGE_KEY, writeEyeCarePreference } from '../child/preferences';

type StorageQuota = { usedBytes: string; reservedBytes: string; totalBytes: string; availableBytes: string; usedPercent: number; warningLevel: 'none' | 'warning' | 'critical' };
type FamilySettings = { freeChoice: boolean };
const readPreference = (key: string, defaultValue = false) => window.localStorage.getItem(key) === null ? defaultValue : window.localStorage.getItem(key) === 'true';
const bytesText = (bytes: string) => `${(Number(bytes) / 1_000_000_000).toFixed(2)} GB`;

export function SettingsPage() {
  const { isRemote } = useAppStore();
  const queryClient = useQueryClient();
  const [freeChoice, setFreeChoice] = useState(true);
  const [eyeCare, setEyeCare] = useState(() => readPreference(EYE_CARE_STORAGE_KEY));
  const [preferenceError, setPreferenceError] = useState('');
  const quota = useQuery({ queryKey: ['parent', 'storage'], queryFn: () => apiRequest<StorageQuota>('/api/storage'), enabled: isRemote });
  const settings = useQuery({ queryKey: ['family', 'settings'], queryFn: () => apiRequest<FamilySettings>('/api/settings'), enabled: isRemote });
  useEffect(() => { if (settings.data) setFreeChoice(settings.data.freeChoice); else if (!isRemote) setFreeChoice(readPreference(FREE_CHOICE_STORAGE_KEY, true)); }, [isRemote, settings.data]);
  const toggleEyeCare = (value: boolean) => { setEyeCare(value); writeEyeCarePreference(value); };
  const toggleFreeChoice = async (value: boolean) => {
    setPreferenceError('');
    setFreeChoice(value);
    if (!isRemote) { window.localStorage.setItem(FREE_CHOICE_STORAGE_KEY, String(value)); return; }
    try {
      const saved = await apiRequest<FamilySettings>('/api/settings', { method: 'PATCH', body: JSON.stringify({ freeChoice: value }) });
      queryClient.setQueryData(['family', 'settings'], saved);
    } catch (cause) {
      setFreeChoice(!value);
      setPreferenceError(cause instanceof Error ? cause.message : '保存儿童端偏好失败，请重试');
    }
  };
  const used = quota.data ? Number(quota.data.usedBytes) + Number(quota.data.reservedBytes) : 0;

  return <div className="parent-page"><div className="page-heading"><div><p className="eyebrow">工作台偏好</p><h1>设置</h1><p className="page-subtitle">儿童端选择规则保存在服务器，护眼模式保存在当前设备。</p></div></div><div className="settings-grid">
    <section className="panel"><div className="panel-heading"><div><h2>MinIO 视频存储</h2><p>家庭视频限额 100 GB，预留中的上传也计入容量。</p></div></div><div className="storage-meter"><span className="metric-icon blue">▣</span><div><strong data-testid="storage-size">{quota.isLoading ? '读取中…' : quota.data ? `${bytesText(String(used))} / ${bytesText(quota.data.totalBytes)}` : isRemote ? '暂不可用' : '服务器管理'}</strong><small>{quota.data ? `已使用 ${quota.data.usedPercent.toFixed(1)}% · 可用 ${bytesText(quota.data.availableBytes)}` : '不使用浏览器 localStorage 保存视频'}</small></div></div>{quota.data?.warningLevel !== 'none' && quota.data && <p className="form-error" role="alert">存储空间接近上限，请先删除不再需要的视频。</p>}{quota.error && <p className="form-error" role="alert">无法读取存储空间：{quota.error instanceof Error ? quota.error.message : '请求失败'} <button type="button" onClick={() => void quota.refetch()}>重试</button></p>}</section>
    <section className="panel"><div className="panel-heading"><div><h2>儿童端偏好</h2><p>下次打开儿童端时继续使用。</p></div></div><label className="setting-toggle"><span><strong>允许自由选课</strong><small>儿童可浏览所有已发布课程</small></span><input aria-label="允许自由选课" type="checkbox" checked={freeChoice} disabled={settings.isLoading} onChange={(event) => void toggleFreeChoice(event.target.checked)} /></label><label className="setting-toggle"><span><strong>护眼模式</strong><small>降低儿童端的对比度和亮度</small></span><input aria-label="护眼模式" type="checkbox" checked={eyeCare} onChange={(event) => toggleEyeCare(event.target.checked)} /></label>{preferenceError && <p className="form-error" role="alert">{preferenceError}</p>}</section>
  </div></div>;
}
