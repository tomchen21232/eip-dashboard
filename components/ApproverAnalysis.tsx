
import React, { useMemo, useState, useEffect } from 'react';
import { ProjectTask, ApprovalStatus } from '../types';
import { 
  AlertTriangle, Loader2, ChevronLeft, ChevronRight, Trophy, List, X, Search, UserCheck, ArrowUpDown, Filter, UserX, Users, Calendar, Clock, MapPin
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell
} from 'recharts';
import { generateTaskSummary } from '../services/geminiService';
import { PageHelp } from './PageHelp';
import { MultiSelect } from './MultiSelect';

interface ApproverAnalysisProps {
  data: ProjectTask[];
}

type SortKey = 'name' | 'totalHandled' | 'pendingCount' | 'completedCount' | 'avgDays';

const safeDate = (dateStr: string) => {
  if (!dateStr) return new Date();
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date() : d;
};

const formatStayTime = (seconds: number) => {
  if (seconds <= 0) return "0分";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}天 ${h}時`;
  if (h > 0) return `${h}時 ${m}分`;
  return `${m}分`;
};

const ApproverAnalysis: React.FC<ApproverAnalysisProps> = ({ data }) => {
  const [isReady, setIsReady] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(15);
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'pendingCount', direction: 'desc' });

  const latestTime = useMemo(() => {
    let max = 0;
    data.forEach(d => {
      const t = safeDate(d.stepStartTime).getTime();
      if (t > max) max = t;
      if (d.stepEndTime) {
          const et = safeDate(d.stepEndTime).getTime();
          if (et > max) max = et;
      }
    });
    return max || Date.now();
  }, [data]);

  const [mainFilters, setMainFilters] = useState({
    nameSearch: '',
    depts: [] as string[],
    statuses: [] as string[]
  });

  const [drillDown, setDrillDown] = useState<{ 
    isOpen: boolean; 
    title: string; 
    personName: string; 
    tasks: ProjectTask[];
    type: 'TOTAL' | 'PENDING' | 'COMPLETED';
  }>({
    isOpen: false, title: '', personName: '', tasks: [], type: 'TOTAL'
  });

  const [drillFilters, setDrillFilters] = useState({
    formId: '',
    formNames: [] as string[],
    statuses: [] as string[],
    approver: ''
  });
  
  const [detailPage, setDetailPage] = useState(1);
  const [aiSummaries, setAiSummaries] = useState<Record<string, string>>({});
  const [loadingAi, setLoadingAi] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const timer = setTimeout(() => setIsReady(true), 150);
    return () => clearTimeout(timer);
  }, []);

  const uniqueFormNames = useMemo(() => Array.from(new Set(data.map(d => d.formName))).sort(), [data]);
  const uniqueDepts = useMemo(() => Array.from(new Set(data.map(d => d.currentApproverDept).filter(Boolean) as string[])).sort(), [data]);
  const allStatusOptions = Object.values(ApprovalStatus);

  const formStatusMap = useMemo(() => {
    const groups: Record<string, ProjectTask[]> = {};
    data.forEach(t => {
      if (!groups[t.formId]) groups[t.formId] = [];
      groups[t.formId].push(t);
    });
    
    const statusMap: Record<string, ApprovalStatus> = {};
    Object.keys(groups).forEach(fid => {
        const logs = groups[fid];
        const sorted = [...logs].sort((a,b) => safeDate(a.stepStartTime).getTime() - safeDate(b.stepStartTime).getTime());
        
        let effectiveMainStatus = '';
        for (let i = sorted.length - 1; i >= 0; i--) {
            if (sorted[i].mainStatus) { effectiveMainStatus = sorted[i].mainStatus; break; }
        }
        const isMainClosed = ["結案", "核准", "完成", "不同意", "退回", "作廢"].some(s => effectiveMainStatus.includes(s)) && !effectiveMainStatus.includes('退回申請者');
        const hasReturned = logs.some(l => l.approvalStatus === ApprovalStatus.RETURNED || (l.mainStatus && l.mainStatus.includes('退回申請者')));
        const hasVeto = logs.some(l => l.approvalStatus === ApprovalStatus.REJECTED || (l.mainStatus && l.mainStatus.includes('否決')));
        const hasCancel = logs.some(l => l.approvalStatus === ApprovalStatus.CANCELLED || (l.mainStatus && (l.mainStatus.includes('撤銷') || l.mainStatus.includes('作廢'))));

        let finalStatus = ApprovalStatus.PENDING;
        if (hasReturned) {
            finalStatus = ApprovalStatus.RETURNED;
        } else if (isMainClosed) {
            if (hasCancel) finalStatus = ApprovalStatus.CANCELLED;
            else if (hasVeto) finalStatus = ApprovalStatus.REJECTED;
            else finalStatus = ApprovalStatus.APPROVED;
        } else {
            if (hasCancel) finalStatus = ApprovalStatus.CANCELLED;
            else if (hasVeto) finalStatus = ApprovalStatus.REJECTED;
            else finalStatus = ApprovalStatus.PENDING;
        }
        statusMap[fid] = finalStatus;
    });
    return statusMap;
  }, [data]);

  const stats = useMemo(() => {
    // 改用 Map 存儲每個人的資料，其中單據用 Set 去重
    const map: Record<string, { 
      name: string, 
      dept: string, 
      isAccountExpired: boolean,
      formIdsSet: Set<string>,         // 總經手單據ID
      pendingFormIdsSet: Set<string>,  // 進行中單據ID
      completedFormIdsSet: Set<string>,// 已完成單據ID
      totalHours: number, 
      logsMap: Record<string, ProjectTask> // 存儲每個單據的最新一筆歷程供鑽取
    }> = {};

    data.forEach(log => {
      const name = log.currentApprover;
      if (!name || name === '-') return;

      // 前置過濾
      if (mainFilters.nameSearch && !name.toLowerCase().includes(mainFilters.nameSearch.toLowerCase())) return;
      if (mainFilters.depts.length > 0 && log.currentApproverDept && !mainFilters.depts.includes(log.currentApproverDept)) return;
      if (mainFilters.statuses.length > 0) {
          const statusLabel = log.isAccountExpired ? "離職/停用" : "在職";
          if (!mainFilters.statuses.includes(statusLabel)) return;
      }

      if (!map[name]) {
        map[name] = { 
          name, 
          dept: log.currentApproverDept || '-', 
          isAccountExpired: log.isAccountExpired,
          formIdsSet: new Set(),
          pendingFormIdsSet: new Set(),
          completedFormIdsSet: new Set(),
          totalHours: 0, 
          logsMap: {} 
        };
      }

      const finalFormStatus = formStatusMap[log.formId];
      const isPending = !log.stepEndTime && (finalFormStatus === ApprovalStatus.PENDING || finalFormStatus === ApprovalStatus.RETURNED);

      // 更新 Set (去重)
      map[name].formIdsSet.add(log.formId);
      if (isPending) {
        map[name].pendingFormIdsSet.add(log.formId);
      } else {
        map[name].completedFormIdsSet.add(log.formId);
        // 只有非 Pending 的步驟才計入平均處理耗時計算
        const start = safeDate(log.stepStartTime).getTime();
        const end = log.stepEndTime ? safeDate(log.stepEndTime).getTime() : latestTime;
        map[name].totalHours += (end - start) / (1000 * 60 * 60);
      }

      // 鑽取用的 logs：保留該人員對該單據處理的最晚一筆記錄
      const currentStored = map[name].logsMap[log.formId];
      if (!currentStored || safeDate(log.stepStartTime).getTime() > safeDate(currentStored.stepStartTime).getTime()) {
          map[name].logsMap[log.formId] = { ...log, approvalStatus: finalFormStatus };
      }
    });

    return Object.values(map).map(s => ({
      name: s.name,
      dept: s.dept,
      isAccountExpired: s.isAccountExpired,
      totalHandled: s.formIdsSet.size,
      pendingCount: s.pendingFormIdsSet.size,
      completedCount: s.completedFormIdsSet.size,
      avgDays: s.completedFormIdsSet.size > 0 ? parseFloat((s.totalHours / s.completedFormIdsSet.size / 24).toFixed(1)) : 0,
      logs: Object.values(s.logsMap)
    }));
  }, [data, mainFilters, formStatusMap, latestTime]);

  const sortedStats = useMemo(() => {
    const result = [...stats];
    result.sort((a, b) => {
      const valA = a[sortConfig.key];
      const valB = b[sortConfig.key];
      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return result;
  }, [stats, sortConfig]);

  const paginatedStats = sortedStats.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.ceil(stats.length / itemsPerPage);

  const top20Pending = useMemo(() => [...stats].sort((a,b) => b.pendingCount - a.pendingCount).slice(0, 20), [stats]);

  const openDrillDown = (personName: string, type: 'TOTAL' | 'PENDING' | 'COMPLETED') => {
    const person = stats.find(s => s.name === personName);
    if (!person) return;

    let filteredTasks = person.logs;
    let titlePrefix = "";
    let preselectedStatuses: string[] = [];

    if (type === 'PENDING') {
      filteredTasks = person.logs.filter(l => !l.stepEndTime && (l.approvalStatus === ApprovalStatus.PENDING || l.approvalStatus === ApprovalStatus.RETURNED));
      titlePrefix = "進行中單據";
      preselectedStatuses = [ApprovalStatus.PENDING, ApprovalStatus.RETURNED];
    } else if (type === 'COMPLETED') {
      filteredTasks = person.logs.filter(l => l.stepEndTime || (l.approvalStatus !== ApprovalStatus.PENDING && l.approvalStatus !== ApprovalStatus.RETURNED));
      titlePrefix = "已結案/經手完成";
      preselectedStatuses = [ApprovalStatus.APPROVED, ApprovalStatus.REJECTED, ApprovalStatus.CANCELLED];
    } else {
      titlePrefix = "經手總單據";
    }

    setDrillDown({
      isOpen: true,
      title: `${personName} - ${titlePrefix}`,
      personName,
      tasks: filteredTasks,
      type
    });
    setDetailPage(1);
    setDrillFilters({ 
      formId: '', 
      formNames: [], 
      statuses: preselectedStatuses, 
      approver: '' 
    });
  };

  const filteredDrillTasks = useMemo(() => {
    return drillDown.tasks.filter(t => {
      if (drillFilters.formId && !t.formId.toLowerCase().includes(drillFilters.formId.toLowerCase())) return false;
      if (drillFilters.formNames.length > 0 && !drillFilters.formNames.includes(t.formName)) return false;
      if (drillFilters.statuses.length > 0 && !drillFilters.statuses.includes(t.approvalStatus)) return false;
      if (drillFilters.approver && !t.currentApprover.toLowerCase().includes(drillFilters.approver.toLowerCase())) return false;
      return true;
    });
  }, [drillDown.tasks, drillFilters]);

  const paginatedDrillTasks = filteredDrillTasks.slice((detailPage - 1) * 20, detailPage * 20);
  const totalDrillPages = Math.ceil(filteredDrillTasks.length / 20);

  const handleSort = (key: SortKey) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const handleAnalyzeOne = async (formId: string) => {
    if (loadingAi[formId] || aiSummaries[formId]) return;
    setLoadingAi(prev => ({ ...prev, [formId]: true }));
    try {
      const logs = data.filter(d => d.formId === formId);
      const summary = await generateTaskSummary(logs);
      setAiSummaries(prev => ({ ...prev, [formId]: summary }));
    } catch (e) { console.error(e); } 
    finally { setLoadingAi(prev => ({ ...prev, [formId]: false })); }
  };

  if (!isReady) return <div className="h-96 flex items-center justify-center text-slate-400">正在計算瓶頸排行榜...</div>;

  return (
    <div className="space-y-6 animate-fade-in relative">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Trophy className="text-indigo-600" /> 當前瓶頸人物排行榜 (The Bottleneck)</h2>
        <PageHelp 
          title="瓶頸排行榜與數據一致性說明"
          description="本表展示每位簽核者手上的負擔量。所有統計皆以「唯一單據 ID」為基礎，確保您點擊數字後看到的明細筆數與排行榜一致。"
          metrics={[
            { label: "經手單數", desc: "該人員在該表單歷程中出現過次數去重後的總單據數量。" },
            { label: "平均單次耗時", desc: "該人員經手已結案單據，從進入該員關卡到該員簽核結束的平均時間。" }
          ]}
        />
      </div>

      <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500 ml-1">人員名稱搜尋</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input 
              type="text" 
              value={mainFilters.nameSearch} 
              onChange={(e) => { setMainFilters(p => ({...p, nameSearch: e.target.value})); setCurrentPage(1); }} 
              className="w-full text-xs border border-slate-300 rounded-lg pl-9 pr-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 h-[38px]" 
              placeholder="搜尋姓名..." 
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500 ml-1">在離職狀態</label>
          <MultiSelect 
            options={["在職", "離職/停用"]} 
            selected={mainFilters.statuses} 
            onChange={(val) => { setMainFilters(p => ({...p, statuses: val})); setCurrentPage(1); }} 
            placeholder="全部狀態"
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <label className="text-xs font-medium text-slate-500 ml-1">部門篩選</label>
          <MultiSelect 
            options={uniqueDepts} 
            selected={mainFilters.depts} 
            onChange={(val) => { setMainFilters(p => ({...p, depts: val})); setCurrentPage(1); }} 
            placeholder="選擇部門..."
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
           <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2 flex-shrink-0">
             <AlertTriangle size={18} className="text-amber-500" /> 進行中案件單量 Top 20 (去重統計)
           </h3>
           <div className="h-[650px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart 
                  data={top20Pending} 
                  layout="vertical" 
                  margin={{ left: 30, right: 30 }}
                  onClick={(state) => {
                    if (state && state.activeLabel) openDrillDown(state.activeLabel, 'PENDING');
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 12, fontWeight: 'bold' }} />
                  <Tooltip cursor={{ fill: '#f8fafc', opacity: 0.5 }} />
                  <Bar dataKey="pendingCount" radius={[0, 4, 4, 0]} barSize={20} className="cursor-pointer">
                    {top20Pending.map((entry, index) => (
                      <Cell key={index} fill={index < 3 ? '#ef4444' : '#6366f1'} />
                    ))}
                    <LabelList dataKey="pendingCount" position="right" fontSize={11} fontWeight="bold" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
           </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-full">
            <div className="p-4 bg-slate-50 border-b border-slate-100 font-bold text-slate-700 flex justify-between items-center">
              <span className="flex items-center gap-2"><Users size={16} className="text-indigo-600"/> 人員 Loading 排行 (不重複單號)</span>
              <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">符合條件: {stats.length} 人</span>
            </div>
            <div className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar">
               <table className="w-full text-[11px] text-left border-collapse">
                  <thead className="bg-white sticky top-0 border-b z-10 shadow-sm">
                    <tr>
                      <th className="p-3 text-slate-500 cursor-pointer hover:bg-slate-50 whitespace-nowrap" onClick={() => handleSort('name')}>人員 / 部門 <ArrowUpDown size={10} className="inline"/></th>
                      <th className="p-3 text-slate-500 text-right cursor-pointer hover:bg-slate-50 whitespace-nowrap" onClick={() => handleSort('totalHandled')}>經手單數 <ArrowUpDown size={10} className="inline"/></th>
                      <th className="p-3 text-slate-500 text-right cursor-pointer hover:bg-slate-50 whitespace-nowrap" onClick={() => handleSort('pendingCount')}>進行中 <ArrowUpDown size={10} className="inline"/></th>
                      <th className="p-3 text-slate-500 text-right cursor-pointer hover:bg-slate-50 whitespace-nowrap" onClick={() => handleSort('completedCount')}>已處理 <ArrowUpDown size={10} className="inline"/></th>
                      <th className="p-3 text-slate-500 text-right cursor-pointer hover:bg-slate-50 whitespace-nowrap" onClick={() => handleSort('avgDays')}>平均(天) <ArrowUpDown size={10} className="inline"/></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {paginatedStats.map((s) => (
                      <tr key={s.name} className="hover:bg-indigo-50/50 transition-colors group">
                        <td className="p-3">
                           <div className="font-bold text-slate-700">{s.name}</div>
                           <div className="text-[9px] text-slate-400 mt-0.5 truncate max-w-[100px]" title={s.dept}>{s.dept}</div>
                           <div className="flex items-center gap-1 mt-0.5">
                             {s.isAccountExpired ? 
                               <span className="text-[8px] px-1 bg-red-50 text-red-500 border border-red-100 rounded">離職</span> : 
                               <span className="text-[8px] px-1 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded">在職</span>
                             }
                           </div>
                        </td>
                        <td className="p-3 text-right">
                          <button onClick={() => openDrillDown(s.name, 'TOTAL')} className="hover:underline font-bold text-slate-600">{s.totalHandled}</button>
                        </td>
                        <td className="p-3 text-right">
                          <button onClick={() => openDrillDown(s.name, 'PENDING')} className="hover:underline font-bold text-red-500">{s.pendingCount}</button>
                        </td>
                        <td className="p-3 text-right">
                          <button onClick={() => openDrillDown(s.name, 'COMPLETED')} className="hover:underline font-bold text-emerald-600">{s.completedCount}</button>
                        </td>
                        <td className={`p-3 text-right font-mono font-bold ${s.avgDays > 5 ? 'text-amber-600' : 'text-slate-400'}`}>{s.avgDays}d</td>
                      </tr>
                    ))}
                  </tbody>
               </table>
            </div>
            <div className="p-3 border-t bg-slate-50 flex justify-between items-center">
              <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="p-1 hover:bg-white rounded border disabled:opacity-30"><ChevronLeft size={14}/></button>
              <span className="text-[10px] font-bold text-slate-500">{currentPage} / {totalPages}</span>
              <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="p-1 hover:bg-white rounded border disabled:opacity-30"><ChevronRight size={14}/></button>
            </div>
        </div>
      </div>

      {/* Drill Down Modal */}
      {drillDown.isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col animate-scale-in">
            <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50 rounded-t-xl">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <UserCheck className="text-indigo-600" /> {drillDown.title} - 明細資料
              </h3>
              <button onClick={() => setDrillDown(p => ({ ...p, isOpen: false }))} className="p-2 hover:bg-slate-200 rounded-full text-slate-500"><X size={20} /></button>
            </div>

            <div className="p-4 border-b border-slate-200 bg-white grid grid-cols-1 md:grid-cols-4 gap-3">
                 <div>
                   <label className="text-xs font-medium text-slate-500 ml-1">表單編號</label>
                   <input type="text" value={drillFilters.formId} onChange={(e) => setDrillFilters(p => ({...p, formId: e.target.value}))} className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 h-[38px]" placeholder="搜尋編號..." />
                 </div>
                 <div>
                   <label className="text-xs font-medium text-slate-500 ml-1">表單名稱</label>
                   <MultiSelect options={uniqueFormNames} selected={drillFilters.formNames} onChange={(val) => setDrillFilters(p => ({...p, formNames: val}))} />
                 </div>
                 <div>
                   <label className="text-xs font-medium text-slate-500 ml-1">單據最終狀態</label>
                   <MultiSelect options={allStatusOptions} selected={drillFilters.statuses} onChange={(val) => setDrillFilters(p => ({...p, statuses: val}))} />
                 </div>
                 <div>
                   <label className="text-xs font-medium text-slate-500 ml-1">目前處理人</label>
                   <input type="text" value={drillFilters.approver} onChange={(e) => setDrillFilters(p => ({...p, approver: e.target.value}))} className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 h-[38px]" placeholder="姓名..." />
                 </div>
            </div>

            <div className="flex-1 overflow-auto relative">
              <table className="w-full text-sm text-left table-fixed">
                <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-10 shadow-sm border-b">
                  <tr>
                    <th className="px-4 py-3 w-[45%]">表單資訊</th>
                    <th className="px-4 py-3 w-[15%]">簽核進度</th>
                    <th className="px-4 py-3 w-[15%]">停留耗時</th>
                    <th className="px-4 py-3 w-[25%]">AI 顧問分析</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedDrillTasks.map(task => (
                    <tr key={task.formId} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 align-top">
                        <div className="flex justify-between items-start gap-2">
                          <span className="font-bold text-indigo-600 whitespace-nowrap">{task.formId}</span>
                          <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-medium border border-indigo-100 truncate max-w-[120px]" title={task.formName}>{task.formName}</span>
                        </div>
                        <div className="text-slate-800 font-medium mt-1.5 truncate text-xs" title={task.subject}>{task.subject}</div>
                        
                        <div className="mt-3 bg-slate-50/50 p-2 rounded border border-slate-100 space-y-1.5">
                           <div className="flex items-center gap-2">
                              <UserCheck size={12} className="text-indigo-400" />
                              <div className="text-[11px] text-slate-600">
                                 <span className="font-bold">{task.applicantName}</span>
                                 <span className="text-slate-400 ml-1 font-normal">({task.applicantAccount || '系統'})</span>
                              </div>
                           </div>
                           <div className="flex items-center gap-2">
                              <MapPin size={12} className="text-slate-400" />
                              <div className="text-[10px] text-slate-500 font-medium truncate" title={task.applicantDept}>
                                 {task.applicantDept}
                              </div>
                           </div>
                           <div className="flex items-center gap-2 pt-0.5 border-t border-slate-200/50">
                              <Clock size={12} className="text-slate-400" />
                              <div className="text-[10px] text-slate-400">
                                 {new Date(task.applyTime).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </div>
                           </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className={`font-bold ${(task.approvalStatus === ApprovalStatus.PENDING || task.approvalStatus === ApprovalStatus.RETURNED) ? 'text-amber-600' : 'text-slate-700'}`}>{task.approvalStatus}</div>
                        <div className="text-xs text-slate-500 mt-1 font-medium truncate">{task.currentApprover}</div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className="font-mono text-xs text-indigo-600 font-medium bg-indigo-50 px-1 rounded">
                           {task.stepEndTime ? task.durationDisplay : formatStayTime((latestTime - safeDate(task.stepStartTime).getTime()) / 1000)}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {loadingAi[task.formId] ? (
                          <div className="flex items-center gap-2 text-xs text-indigo-500"><Loader2 size={12} className="animate-spin" /></div>
                        ) : aiSummaries[task.formId] ? (
                          <div className="text-[10px] text-slate-600 italic leading-relaxed border-l-2 border-indigo-100 pl-2">{aiSummaries[task.formId]}</div>
                        ) : (
                          <button onClick={() => handleAnalyzeOne(task.formId)} className="text-[10px] text-indigo-600 border border-indigo-200 px-2 py-0.5 rounded hover:bg-indigo-50 transition-all shadow-sm">分析</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredDrillTasks.length === 0 && <tr><td colSpan={4} className="p-20 text-center text-slate-400">查無符合條件的表單資料</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 rounded-b-xl flex justify-between items-center">
              <span className="text-xs text-slate-500 font-bold">符合結果: {filteredDrillTasks.length} 筆</span>
              <div className="flex gap-2">
                <button disabled={detailPage === 1} onClick={() => setDetailPage(p => p - 1)} className="p-1 border rounded bg-white hover:bg-slate-50 disabled:opacity-50"><ChevronLeft size={16}/></button>
                <span className="text-xs self-center font-bold px-4">{detailPage} / {totalDrillPages || 1}</span>
                <button disabled={detailPage === totalDrillPages || totalDrillPages === 0} onClick={() => setDetailPage(p => p + 1)} className="p-1 border rounded bg-white hover:bg-slate-50 disabled:opacity-50"><ChevronRight size={16}/></button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ApproverAnalysis;
