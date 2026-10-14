
import React, { useState, useMemo, useEffect, useTransition } from 'react';
import { ProjectTask, ApprovalStatus } from '../types';
import { FunnelChart, Funnel, Tooltip, ResponsiveContainer, LabelList, Cell } from 'recharts';
import { Loader2, ArrowRight, X, List, ChevronLeft, ChevronRight, Search, Calendar, Clock, MapPin, UserCheck } from 'lucide-react';
import { MultiSelect } from './MultiSelect';
import { PageHelp } from './PageHelp';
import { generateTaskSummary } from '../services/geminiService';

interface ProcessFunnelProps {
  data: ProjectTask[];
}

const safeDate = (dateStr: string) => {
  if (!dateStr) return new Date();
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date() : d;
};

const formatStayTime = (seconds: number) => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}天 ${h}時`;
  if (h > 0) return `${h}時 ${m}分`;
  return `${m}分`;
};

const ProcessFunnel: React.FC<ProcessFunnelProps> = ({ data }) => {
  const [isReady, setIsReady] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  });

  const [drillDown, setDrillDown] = useState<{ isOpen: boolean; title: string; filter: string | null; data: ProjectTask[] }>({
    isOpen: false, title: '', filter: null, data: []
  });

  const [drillFilters, setDrillFilters] = useState({
    formId: '',
    formNames: [] as string[],
    statuses: [] as string[],
    approver: ''
  });

  const [aiSummaries, setAiSummaries] = useState<Record<string, string>>({});
  const [loadingAi, setLoadingAi] = useState<Record<string, boolean>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  useEffect(() => {
    const timer = setTimeout(() => setIsReady(true), 150);
    return () => clearTimeout(timer);
  }, []);

  const [filters, setFilters] = useState<{ status: string[], formName: string[], dept: string[] }>({ status: [], formName: [], dept: [] });

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

  const uniqueFormNames = useMemo(() => Array.from(new Set(data.map(d => d.formName))).sort(), [data]);
  const uniqueDepts = useMemo(() => Array.from(new Set(data.map(d => d.applicantDept))).sort(), [data]);
  const allStatusOptions = Object.values(ApprovalStatus);

  const funnelAnalysis = useMemo(() => {
    const startRange = new Date(startDate).getTime();
    const endRange = new Date(endDate).setHours(23, 59, 59, 999);

    const groups: Record<string, ProjectTask[]> = {};
    data.forEach(t => {
      const applyTime = safeDate(t.applyTime).getTime();
      if (applyTime < startRange || applyTime > endRange) return;
      
      if (filters.status.length > 0 && !filters.status.includes(t.approvalStatus)) return;
      if (filters.formName.length > 0 && !filters.formName.includes(t.formName)) return;
      if (filters.dept.length > 0 && !filters.dept.includes(t.applicantDept)) return;

      if (!groups[t.formId]) groups[t.formId] = [];
      groups[t.formId].push(t);
    });

    const analyzedForms = Object.values(groups).map(logs => {
      const sorted = [...logs].sort((a, b) => safeDate(a.stepStartTime).getTime() - safeDate(b.stepStartTime).getTime());
      
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

      const lastStep = sorted[sorted.length - 1];
      const stepStart = safeDate(lastStep.stepStartTime).getTime();
      const stepEnd = lastStep.stepEndTime ? safeDate(lastStep.stepEndTime).getTime() : latestTime;
      const stepDurationSeconds = (stepEnd - stepStart) / 1000;

      return {
        ...lastStep,
        approvalStatus: finalStatus,
        currentStepDurationDisplay: formatStayTime(stepDurationSeconds),
        isStuck24h: (finalStatus === ApprovalStatus.PENDING || finalStatus === ApprovalStatus.RETURNED) && stepDurationSeconds > 86400,
        isCompleted: finalStatus !== ApprovalStatus.PENDING && finalStatus !== ApprovalStatus.RETURNED
      };
    });

    const totalList = analyzedForms;
    const pendingList = analyzedForms.filter(t => !t.isCompleted);
    const stuckList = analyzedForms.filter(t => t.isStuck24h);
    const completedList = analyzedForms.filter(t => t.isCompleted);

    return {
      total: totalList,
      pending: pendingList,
      stuck: stuckList,
      completed: completedList,
      chartData: [
        { name: '收到申請 (總量)', value: totalList.length, fill: '#6366f1', key: 'total' },
        { name: '簽核流轉中', value: pendingList.length, fill: '#f59e0b', key: 'pending' },
        { name: '滯留超過 24h', value: stuckList.length, fill: '#ef4444', key: 'stuck' },
        { name: '成功結案', value: completedList.length, fill: '#10b981', key: 'completed' }
      ]
    };
  }, [data, startDate, endDate, filters, latestTime]);

  const openDrillDown = (key: 'total' | 'pending' | 'stuck' | 'completed', title: string) => {
    let preselectedStatuses: string[] = [];
    if (key === 'completed') {
      preselectedStatuses = [ApprovalStatus.APPROVED, ApprovalStatus.REJECTED, ApprovalStatus.CANCELLED];
    } else if (key === 'pending' || key === 'stuck') {
      preselectedStatuses = [ApprovalStatus.PENDING, ApprovalStatus.RETURNED];
    }

    setDrillDown({
      isOpen: true,
      title,
      filter: key,
      data: funnelAnalysis[key]
    });
    setDrillFilters({ formId: '', formNames: [], statuses: preselectedStatuses, approver: '' });
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

  if (!isReady) return <div className="h-96 flex items-center justify-center text-slate-400"><Loader2 className="animate-spin mr-2"/> 正在計算流程漏斗...</div>;

  return (
    <div className="space-y-6 animate-fade-in relative">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-slate-800">BPR 流程轉化漏斗</h2>
        <PageHelp 
          title="流程漏斗閱讀指南"
          description="識別表單生命週期。從「收到申請」到「成功結案」，在哪個轉化階段案件停留最久或流失最多？"
          metrics={[
            { label: "結案判定規則", desc: "優先採用主表狀態，若主表狀態包含[結案、完成、核准、不同意、退回、作廢]，即判定為結案。" },
            { label: "滯留 24h", desc: "目前站點尚未簽核結束，且起始時間距離資料集最新時間已超過 24 小時。" }
          ]}
        />
      </div>

      <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500 ml-1">申請時間區間</label>
          <div className="flex items-center gap-1 border border-slate-300 rounded-lg px-2 py-2 bg-white h-[38px]">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="text-xs outline-none bg-transparent w-full" />
            <span className="text-slate-400">~</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="text-xs outline-none bg-transparent w-full" />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500 ml-1">申請部門</label>
          <MultiSelect options={uniqueDepts} selected={filters.dept} onChange={(val) => setFilters(p=>({...p, dept: val}))} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500 ml-1">表單類別</label>
          <MultiSelect options={uniqueFormNames} selected={filters.formName} onChange={(val) => setFilters(p=>({...p, formName: val}))} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
        <div className="lg:col-span-2 bg-white p-8 rounded-xl shadow-sm border border-slate-200 flex flex-col">
          <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2 flex-shrink-0"><List size={18} className="text-indigo-600"/> 流程生存轉化率 (點擊查看明細)</h3>
          <div className="flex-1 min-h-[440px]">
            <ResponsiveContainer width="100%" height="100%">
              <FunnelChart>
                <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} />
                <Funnel 
                  dataKey="value" 
                  data={funnelAnalysis.chartData} 
                  isAnimationActive 
                  onClick={(data: any) => openDrillDown(data.key, data.name)}
                  className="cursor-pointer"
                >
                  <LabelList position="right" fill="#64748b" stroke="none" dataKey="name" fontSize={12} />
                  <LabelList position="center" fill="#fff" stroke="none" dataKey="value" fontWeight="bold" />
                </Funnel>
              </FunnelChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="flex flex-col justify-between space-y-4 h-full">
          {funnelAnalysis.chartData.map((item, idx) => (
            <div 
              key={idx} 
              onClick={() => openDrillDown(item.key as any, item.name)}
              className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm relative overflow-hidden group cursor-pointer hover:shadow-md transition-all flex-1 flex flex-col justify-center"
            >
              <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: item.fill }}></div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-slate-500">{item.name}</span>
                <ArrowRight size={14} className="text-slate-300 group-hover:translate-x-1 transition-transform" />
              </div>
              <div className="text-3xl font-bold mt-2" style={{ color: item.fill }}>{item.value.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>

      {drillDown.isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col animate-scale-in border-t-4 border-indigo-500">
            <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50 rounded-t-xl">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><List className="text-indigo-600" /> {drillDown.title}</h3>
              <button onClick={() => setDrillDown(p => ({ ...p, isOpen: false }))} className="p-2 hover:bg-slate-200 rounded-full text-slate-500 transition-colors"><X size={20} /></button>
            </div>

            <div className="p-4 border-b border-slate-200 bg-white grid grid-cols-1 md:grid-cols-4 gap-3">
                 <div>
                   <label className="text-xs font-medium text-slate-500 ml-1">表單單號</label>
                   <input type="text" value={drillFilters.formId} onChange={(e) => setDrillFilters(p => ({...p, formId: e.target.value}))} className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 h-[38px] outline-none focus:ring-1 focus:ring-indigo-500" placeholder="搜尋編號..." />
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
                   <input type="text" value={drillFilters.approver} onChange={(e) => setDrillFilters(p => ({...p, approver: e.target.value}))} className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 h-[38px] outline-none focus:ring-1 focus:ring-indigo-500" placeholder="姓名..." />
                 </div>
            </div>

            <div className="flex-1 overflow-auto relative">
              <table className="w-full text-sm text-left table-fixed">
                <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-10 shadow-sm border-b">
                  <tr>
                    <th className="px-4 py-3 w-[45%]">表單與申請資訊</th>
                    <th className="px-4 py-3 w-[15%]">進度</th>
                    <th className="px-4 py-3 w-[15%]">滯留時間</th>
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
                        
                        {/* 優化申請人與部門資訊顯示 */}
                        <div className="mt-3 bg-indigo-50/30 p-2 rounded border border-indigo-100/50 space-y-1">
                           <div className="flex items-center gap-2">
                              <UserCheck size={11} className="text-indigo-400" />
                              <div className="text-[11px] text-slate-700">
                                 <span className="font-bold">{task.applicantName}</span>
                                 <span className="text-slate-400 ml-1 font-normal text-[10px]">({task.applicantAccount || 'N/A'})</span>
                              </div>
                           </div>
                           <div className="flex items-center gap-2">
                              <MapPin size={11} className="text-slate-400" />
                              <div className="text-[10px] text-slate-500 font-semibold truncate" title={task.applicantDept}>
                                 {task.applicantDept}
                              </div>
                           </div>
                           <div className="flex items-center gap-2 pt-1 mt-1 border-t border-indigo-100/30">
                              <Calendar size={11} className="text-slate-400" />
                              <div className="text-[10px] text-slate-400">
                                 {new Date(task.applyTime).toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </div>
                           </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className={`font-bold ${(task.approvalStatus === ApprovalStatus.PENDING || task.approvalStatus === ApprovalStatus.RETURNED) ? 'text-amber-600' : 'text-slate-700'}`}>{task.approvalStatus}</div>
                        <div className="text-xs text-slate-500 mt-1 font-medium text-indigo-600 truncate">{task.currentApprover}</div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className="font-mono text-xs text-slate-600 font-semibold bg-slate-100 px-1 rounded">
                           {(task as any).currentStepDurationDisplay}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {loadingAi[task.formId] ? (
                          <div className="flex items-center gap-2 text-xs text-indigo-500"><Loader2 size={12} className="animate-spin" /></div>
                        ) : aiSummaries[task.formId] ? (
                          <div className="text-xs text-slate-600 italic leading-relaxed border-l-2 border-indigo-200 pl-2">{aiSummaries[task.formId]}</div>
                        ) : (
                          <button onClick={() => handleAnalyzeOne(task.formId)} className="text-[10px] text-indigo-600 border border-indigo-200 px-2 py-0.5 rounded hover:bg-indigo-50 transition-colors shadow-sm">啟動 AI</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 rounded-b-xl flex justify-between items-center">
              <span className="text-xs text-slate-500 font-bold">總筆數: {filteredDrillTasks.length}</span>
              <div className="flex gap-2">
                <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="p-1 border rounded bg-white hover:bg-slate-50 disabled:opacity-50 transition-colors"><ChevronLeft size={16}/></button>
                <span className="text-xs self-center font-bold px-4">{currentPage} / {totalPages || 1}</span>
                <button disabled={currentPage === totalPages || totalPages === 0} onClick={() => setCurrentPage(p => p + 1)} className="p-1 border rounded bg-white hover:bg-slate-50 disabled:opacity-50 transition-colors"><ChevronRight size={16}/></button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProcessFunnel;
