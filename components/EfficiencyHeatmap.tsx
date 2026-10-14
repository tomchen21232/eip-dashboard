
import React, { useState, useMemo, useEffect, useTransition } from 'react';
import { ProjectTask, ApprovalStatus } from '../types';
import { Filter, Loader2, BarChart2, TrendingUp, X, List, ChevronLeft, ChevronRight, Search, Info, Calendar, Clock, MapPin, UserCheck } from 'lucide-react';
import { MultiSelect } from './MultiSelect';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  Cell, LabelList 
} from 'recharts';
import { PageHelp } from './PageHelp';
import { generateTaskSummary } from '../services/geminiService';

interface EfficiencyHeatmapProps {
  data: ProjectTask[];
}

const safeDate = (dateStr: string) => {
  if (!dateStr) return new Date(0);
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date(0) : d;
};

const formatStayTime = (days: number) => {
    if (days < 0.04) return `${Math.round(days * 24 * 60)}分`;
    if (days < 1) return `${Math.round(days * 24)}時`;
    const d = Math.floor(days);
    const h = Math.round((days - d) * 24);
    if (h === 0) return `${d}天`;
    return `${d}天 ${h}時`;
};

const EfficiencyHeatmap: React.FC<EfficiencyHeatmapProps> = ({ data }) => {
  const [isReady, setIsReady] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [drillDown, setDrillDown] = useState<{ isOpen: boolean; title: string; data: ProjectTask[] }>({
    isOpen: false, title: '', data: []
  });
  
  const [drillFilters, setDrillFilters] = useState({
    formId: '',
    formNames: [] as string[],
    statuses: [] as string[],
    approver: ''
  });

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const [aiSummaries, setAiSummaries] = useState<Record<string, string>>({});
  const [loadingAi, setLoadingAi] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const timer = setTimeout(() => setIsReady(true), 150);
    return () => clearTimeout(timer);
  }, []);

  const latestDatasetTime = useMemo(() => {
    let max = 0;
    data.forEach(d => {
      const t1 = safeDate(d.stepStartTime).getTime();
      const t2 = d.stepEndTime ? safeDate(d.stepEndTime).getTime() : 0;
      if (t1 > max) max = t1;
      if (t2 > max) max = t2;
    });
    return max || Date.now();
  }, [data]);

  const processedLogs = useMemo(() => {
    if (!isReady) return [];
    return data.map(d => {
      const start = safeDate(d.stepStartTime).getTime();
      const end = d.stepEndTime ? safeDate(d.stepEndTime).getTime() : latestDatasetTime;
      const durationDays = Math.max(0, (end - start) / (1000 * 60 * 60 * 24));
      return {
        ...d,
        logDurationDays: durationDays
      };
    });
  }, [data, isReady, latestDatasetTime]);

  const uniqueFormNames = useMemo(() => Array.from(new Set(processedLogs.map(d => d.formName))).sort(), [processedLogs]);
  const uniqueDepts = useMemo(() => Array.from(new Set(processedLogs.map(d => d.applicantDept))).sort(), [processedLogs]);
  const allStatusOptions = Object.values(ApprovalStatus);

  const [filters, setFilters] = useState<{ depts: string[], forms: string[] }>({ depts: [], forms: [] });

  const filteredLogs = useMemo(() => {
    return processedLogs.filter(t => {
      if (filters.depts.length > 0 && !filters.depts.includes(t.applicantDept)) return false;
      if (filters.forms.length > 0 && !filters.forms.includes(t.formName)) return false;
      return true;
    });
  }, [processedLogs, filters]);

  const heatmapData = useMemo(() => {
    const matrixMap: Record<string, Record<string, Record<string, { totalDays: number, logs: any[] }>>> = {};
    const forms = filters.forms.length > 0 ? filters.forms : uniqueFormNames.slice(0, 10);
    const depts = filters.depts.length > 0 ? filters.depts : uniqueDepts.slice(0, 15);

    filteredLogs.forEach(log => {
      if (!matrixMap[log.applicantDept]) matrixMap[log.applicantDept] = {};
      if (!matrixMap[log.applicantDept][log.formName]) matrixMap[log.applicantDept][log.formName] = {};
      
      if (!matrixMap[log.applicantDept][log.formName][log.formId]) {
          matrixMap[log.applicantDept][log.formName][log.formId] = { totalDays: 0, logs: [] };
      }
      
      matrixMap[log.applicantDept][log.formName][log.formId].totalDays += log.logDurationDays;
      matrixMap[log.applicantDept][log.formName][log.formId].logs.push(log);
    });

    const matrix: Record<string, Record<string, { avgDays: number, totalForms: number, allLogs: any[] }>> = {};
    Object.keys(matrixMap).forEach(dept => {
      matrix[dept] = {};
      Object.keys(matrixMap[dept]).forEach(form => {
        const formsInCell = matrixMap[dept][form];
        const formIds = Object.keys(formsInCell);
        const totalForms = formIds.length;
        const totalDaysAllForms = formIds.reduce((sum, fid) => sum + formsInCell[fid].totalDays, 0);
        const avgDays = totalForms > 0 ? totalDaysAllForms / totalForms : 0;
        
        const allLogs: any[] = [];
        formIds.forEach(fid => allLogs.push(...formsInCell[fid].logs));
        
        matrix[dept][form] = { avgDays, totalForms, allLogs };
      });
    });

    return { depts, forms, matrix };
  }, [filteredLogs, filters, uniqueFormNames, uniqueDepts]);

  const openDrillDown = (logs: any[], title: string) => {
    const formGroups: Record<string, any[]> = {};
    logs.forEach(l => {
        if (!formGroups[l.formId]) formGroups[l.formId] = [];
        formGroups[l.formId].push(l);
    });

    const aggregatedTasks = Object.values(formGroups).map(group => {
        const sorted = [...group].sort((a, b) => safeDate(a.stepStartTime).getTime() - safeDate(b.stepStartTime).getTime());
        const totalDaysForThisForm = group.reduce((sum, item: any) => sum + item.logDurationDays, 0);
        
        const lastLog = sorted[sorted.length - 1];
        let effectiveMainStatus = '';
        for (let i = sorted.length - 1; i >= 0; i--) {
            if (sorted[i].mainStatus) { effectiveMainStatus = sorted[i].mainStatus; break; }
        }
        const isMainClosed = ["結案", "核准", "完成", "不同意", "退回", "作廢"].some(s => effectiveMainStatus.includes(s)) && !effectiveMainStatus.includes('退回申請者');
        const hasReturned = group.some((l:any) => l.approvalStatus === ApprovalStatus.RETURNED || (l.mainStatus && l.mainStatus.includes('退回申請者')));
        const hasVeto = group.some((l:any) => l.approvalStatus === ApprovalStatus.REJECTED || (l.mainStatus && l.mainStatus.includes('否決')));
        const hasCancel = group.some((l:any) => l.approvalStatus === ApprovalStatus.CANCELLED || (l.mainStatus && (l.mainStatus.includes('撤銷') || l.mainStatus.includes('作廢'))));

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

        return {
            ...lastLog,
            approvalStatus: finalStatus,
            aggregatedDaysDisplay: formatStayTime(totalDaysForThisForm)
        };
    });

    setDrillDown({ isOpen: true, title, data: aggregatedTasks });
    setDrillFilters({ 
        formId: '', 
        formNames: [], 
        statuses: [ApprovalStatus.APPROVED, ApprovalStatus.REJECTED, ApprovalStatus.CANCELLED, ApprovalStatus.PENDING, ApprovalStatus.RETURNED], 
        approver: '' 
    });
    setCurrentPage(1);
  };

  const filteredDrillTasks = useMemo(() => {
    return drillDown.data.filter(t => {
      if (drillFilters.formId && !t.formId.toLowerCase().includes(drillFilters.formId.toLowerCase())) return false;
      if (drillFilters.formNames.length > 0 && !drillFilters.formNames.includes(t.formName)) return false;
      if (drillFilters.statuses.length > 0 && !drillFilters.statuses.includes(t.approvalStatus)) return false;
      if (drillFilters.approver && !t.currentApprover.toLowerCase().includes(drillFilters.approver.toLowerCase())) return false;
      return true;
    });
  }, [drillDown.data, drillFilters]);

  const paginatedData = filteredDrillTasks.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.ceil(filteredDrillTasks.length / itemsPerPage);

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

  const getHeatColor = (days: number) => {
    if (days === 0) return 'bg-slate-50 text-slate-300';
    if (days < 2) return 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200';
    if (days < 5) return 'bg-amber-100 text-amber-700 hover:bg-amber-200';
    if (days < 14) return 'bg-orange-100 text-orange-700 hover:bg-orange-200';
    return 'bg-red-200 text-red-800 font-bold hover:bg-red-300';
  };

  if (!isReady) return <div className="h-96 flex items-center justify-center text-slate-400"><Loader2 className="animate-spin mr-2"/> 正在準備效率矩陣...</div>;

  return (
    <div className="space-y-6 animate-fade-in relative">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><BarChart2 className="text-indigo-600"/> 效率熱點與變異分析</h2>
        <PageHelp 
          title="效率熱圖與統計術語說明"
          description="分析「部門與表單」之間的效率匹配。我們將時間定義為該部門在流程站點中所消耗的累積天數。"
          metrics={[
            { label: "平均值 (Avg)", desc: "計算方式為：該部門經手該表單的所有單號耗時總和 / 總單數。" },
            { label: "中位數 (Median)", desc: "代表「最普遍」的處理速度，若平均數遠大於中位數，表示有「少數老鼠屎」拖慢整體。" },
            { label: "熱度顏色", desc: "綠色 (<2天)；黃色 (<5天)；紅色 (>14天)。" }
          ]}
        />
      </div>

      <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500 ml-1">篩選申請部門 (Y軸)</label>
          <MultiSelect options={uniqueDepts} selected={filters.depts} onChange={(val) => setFilters(p => ({...p, depts: val}))} placeholder="全部部門" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500 ml-1">篩選表單類別 (X軸)</label>
          <MultiSelect options={uniqueFormNames} selected={filters.forms} onChange={(val) => setFilters(p => ({...p, forms: val}))} placeholder="全部表單" />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50">
           <h3 className="font-bold text-slate-800 flex items-center gap-2">部門 x 表單：平均處理天數矩陣 (點擊鑽取明細)</h3>
           <div className="flex gap-4 mt-2">
              <span className="text-[10px] text-slate-500 flex items-center gap-1"><div className="w-2 h-2 bg-emerald-100 rounded"></div> 2天內</span>
              <span className="text-[10px] text-slate-500 flex items-center gap-1"><div className="w-2 h-2 bg-amber-100 rounded"></div> 5天內</span>
              <span className="text-[10px] text-slate-500 flex items-center gap-1"><div className="w-2 h-2 bg-red-200 rounded"></div> 14天以上</span>
           </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-center border-collapse">
            <thead>
              <tr className="bg-slate-100">
                <th className="p-4 border-b border-r text-left min-w-[150px] sticky left-0 bg-slate-100 z-10 font-bold">申請部門 \ 表單</th>
                {heatmapData.forms.map(f => (
                  <th key={f} className="p-3 border-b min-w-[120px] text-slate-700 font-bold whitespace-nowrap overflow-hidden text-ellipsis" title={f}>{f}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {heatmapData.depts.map(dept => (
                <tr key={dept} className="border-b hover:bg-slate-50 transition-colors">
                  <td className="p-4 border-r font-bold text-left text-slate-700 sticky left-0 bg-white z-10 shadow-sm">{dept}</td>
                  {heatmapData.forms.map(form => {
                    const cell = heatmapData.matrix[dept]?.[form];
                    const avg = cell ? parseFloat(cell.avgDays.toFixed(1)) : 0;
                    return (
                      <td key={form} className="p-1">
                        <div 
                          onClick={() => cell && openDrillDown(cell.allLogs, `${dept} - ${form}`)}
                          className={`py-3 rounded-lg m-1 transition-all cursor-pointer font-bold text-sm ${getHeatColor(avg)}`} 
                        >
                          {avg || '-'}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drill Down Modal with Updated Field Info */}
      {drillDown.isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col animate-scale-in border-t-4 border-indigo-500">
            <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50 rounded-t-xl">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><List className="text-indigo-600" /> {drillDown.title} - 明細資料</h3>
              <button onClick={() => setDrillDown(p => ({ ...p, isOpen: false }))} className="p-2 hover:bg-slate-200 rounded-full text-slate-500 transition-colors"><X size={20} /></button>
            </div>

            <div className="p-4 border-b border-slate-200 bg-white grid grid-cols-1 md:grid-cols-4 gap-3">
                 <div>
                   <label className="text-xs font-medium text-slate-500 ml-1">表單單號</label>
                   <input type="text" value={drillFilters.formId} onChange={(e) => setDrillFilters(p => ({...p, formId: e.target.value}))} className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 h-[38px]" placeholder="搜尋編號..." />
                 </div>
                 <div>
                   <label className="text-xs font-medium text-slate-500 ml-1">表單名稱</label>
                   <MultiSelect options={uniqueFormNames} selected={drillFilters.formNames} onChange={(val) => setDrillFilters(p => ({...p, formNames: val}))} />
                 </div>
                 <div>
                   <label className="text-xs font-medium text-slate-500 ml-1">狀態</label>
                   <MultiSelect options={allStatusOptions} selected={drillFilters.statuses} onChange={(val) => setDrillFilters(p => ({...p, statuses: val}))} />
                 </div>
                 <div>
                   <label className="text-xs font-medium text-slate-500 ml-1">簽核者</label>
                   <input type="text" value={drillFilters.approver} onChange={(e) => setDrillFilters(p => ({...p, approver: e.target.value}))} className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 h-[38px]" placeholder="姓名..." />
                 </div>
            </div>

            <div className="flex-1 overflow-auto relative">
              <table className="w-full text-sm text-left table-fixed">
                <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-10 shadow-sm border-b">
                  <tr>
                    <th className="px-4 py-3 w-[45%]">表單資訊</th>
                    <th className="px-4 py-3 w-[15%]">進度</th>
                    <th className="px-4 py-3 w-[15%]">累積耗時</th>
                    <th className="px-4 py-3 w-[25%]">AI 顧問分析</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedData.map(task => (
                    <tr key={task.formId} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 align-top">
                        <div className="flex justify-between items-start gap-2">
                          <span className="font-bold text-indigo-600 whitespace-nowrap">{task.formId}</span>
                          <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-medium border border-indigo-100 truncate max-w-[120px]" title={task.formName}>{task.formName}</span>
                        </div>
                        <div className="text-slate-800 font-medium mt-1.5 truncate text-xs" title={task.subject}>{task.subject}</div>
                        
                        {/* 申請者與 [申請者部門名稱]：視覺化呈現優化 */}
                        <div className="mt-3 bg-slate-50 p-2 rounded-lg border border-slate-100 space-y-1.5 shadow-inner">
                           <div className="flex items-center gap-2">
                              <UserCheck size={12} className="text-indigo-500" />
                              <div className="text-[11px] text-slate-700">
                                 <span className="font-bold">{task.applicantName}</span>
                                 <span className="text-slate-400 ml-1 font-normal text-[10px]">({task.applicantAccount || '系統'})</span>
                              </div>
                           </div>
                           <div className="flex items-center gap-2">
                              <MapPin size={12} className="text-amber-500" />
                              <div className="text-[10px] text-slate-600 font-bold truncate bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100" title={task.applicantDept}>
                                 {task.applicantDept}
                              </div>
                           </div>
                           <div className="flex items-center gap-2 pt-1 border-t border-slate-200/50">
                              <Clock size={12} className="text-slate-400" />
                              <div className="text-[10px] text-slate-400">
                                 {new Date(task.applyTime).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </div>
                           </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="font-bold text-slate-700">{task.approvalStatus}</div>
                        <div className="text-xs text-slate-500 mt-1 truncate">目前: <span className="font-medium text-indigo-600">{task.currentApprover}</span></div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className="font-mono text-xs text-indigo-700 font-bold bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 shadow-sm">
                           {(task as any).aggregatedDaysDisplay}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {loadingAi[task.formId] ? (
                          <div className="flex items-center gap-2 text-xs text-indigo-500"><Loader2 size={12} className="animate-spin" /></div>
                        ) : aiSummaries[task.formId] ? (
                          <div className="text-[11px] text-slate-600 leading-relaxed italic border-l-2 border-indigo-100 pl-2">{aiSummaries[task.formId]}</div>
                        ) : (
                          <button onClick={() => handleAnalyzeOne(task.formId)} className="text-[11px] text-indigo-600 border border-indigo-200 px-2 py-0.5 rounded hover:bg-indigo-50 transition-colors shadow-sm font-medium">歷程分析</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 rounded-b-xl flex justify-between items-center">
              <span className="text-xs text-slate-500 font-bold">符合單據筆數: {filteredDrillTasks.length}</span>
              <div className="flex gap-2">
                <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="p-1 border rounded bg-white hover:bg-slate-50 transition-all disabled:opacity-50"><ChevronLeft size={16}/></button>
                <span className="text-xs self-center font-bold px-4">{currentPage} / {totalPages || 1}</span>
                <button disabled={currentPage === totalPages || totalPages === 0} onClick={() => setCurrentPage(p => p + 1)} className="p-1 border rounded bg-white hover:bg-slate-50 transition-all disabled:opacity-50"><ChevronRight size={16}/></button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EfficiencyHeatmap;
