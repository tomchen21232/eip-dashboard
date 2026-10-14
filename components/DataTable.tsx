
import React, { useState, useMemo, useEffect, useTransition } from 'react';
import { ProjectTask, ApprovalStatus } from '../types';
import { ArrowUpDown, ChevronLeft, ChevronRight, Search, Loader2, Filter } from 'lucide-react';
import { MultiSelect } from './MultiSelect';
import { PageHelp } from './PageHelp';

interface DataTableProps {
  data: ProjectTask[];
}

interface FilterState {
  status: string[]; // Changed to Array
  formId: string;
  formName: string[]; // Changed to Array
  approver: string;
  applicant: string; // New filter
  subject: string; 
  applyDateStart: string;
  applyDateEnd: string;
  stepDateStart: string;
  stepDateEnd: string;
}

const safeDate = (dateStr: string) => {
  if (!dateStr) return new Date();
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date() : d;
};

const DataTable: React.FC<DataTableProps> = ({ data }) => {
  const [isPending, startTransition] = useTransition();
  // Lazy load state to prevent mobile freezing on mount
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
     // Small delay to allow tab switching animation to finish before heavy rendering
     const timer = setTimeout(() => setIsReady(true), 100);
     return () => clearTimeout(timer);
  }, []);

  const [activeFilters, setActiveFilters] = useState<FilterState>({
    status: [], formId: '', formName: [], approver: '', applicant: '', subject: '',
    applyDateStart: '', applyDateEnd: '', stepDateStart: '', stepDateEnd: ''
  });
  
  // Direct state for inputs to allow typing, but applied to activeFilters via transition
  const [inputState, setInputState] = useState<FilterState>(activeFilters);

  const [sortField, setSortField] = useState<keyof ProjectTask>('applyTime');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);

  // Debounce logic for text inputs
  useEffect(() => {
    const handler = setTimeout(() => {
      startTransition(() => {
          setActiveFilters(inputState);
          setCurrentPage(1);
      });
    }, 600); // 600ms debounce
    return () => clearTimeout(handler);
  }, [inputState]);

  // Handle MultiSelect changes (Immediate transition, no debounce needed)
  const handleMultiSelectChange = (key: keyof FilterState, val: string[]) => {
      setInputState(prev => ({ ...prev, [key]: val }));
      // For multi-selects, we can trigger update faster or immediately
      startTransition(() => {
          setActiveFilters(prev => ({ ...prev, [key]: val }));
          setCurrentPage(1);
      });
  };

  const uniqueFormNames = useMemo(() => {
    if (!isReady) return [];
    const names = new Set(data.map(t => t.formName).filter(Boolean));
    return Array.from(names).sort();
  }, [data, isReady]);

  const allStatusOptions = Object.values(ApprovalStatus);

  const handleSort = (field: keyof ProjectTask) => {
    let effectiveField = field;
    if (field === 'durationDisplay') effectiveField = 'durationSeconds';
    if (sortField === effectiveField) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(effectiveField);
      setSortDir('desc');
    }
  };

  const compareValues = (a: any, b: any) => {
    if (a === b) return 0;
    if (a === null || a === undefined) return 1;
    if (b === null || b === undefined) return -1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    const strA = String(a).toLowerCase().trim();
    const strB = String(b).toLowerCase().trim();
    return strA.localeCompare(strB, 'zh-TW', { numeric: true });
  };

  const filteredData = useMemo(() => {
    if (!isReady) return [];
    
    const result = data.filter(item => {
        if (activeFilters.status.length > 0 && !activeFilters.status.includes(item.approvalStatus)) return false;
        if (activeFilters.formName.length > 0 && !activeFilters.formName.includes(item.formName)) return false;
        
        if (activeFilters.formId.trim() && !item.formId.toLowerCase().includes(activeFilters.formId.toLowerCase().trim())) return false;
        if (activeFilters.approver.trim() && !item.currentApprover.toLowerCase().includes(activeFilters.approver.toLowerCase().trim())) return false;
        if (activeFilters.applicant.trim() && !item.applicantName.toLowerCase().includes(activeFilters.applicant.toLowerCase().trim())) return false;
        if (activeFilters.subject.trim() && !item.subject.toLowerCase().includes(activeFilters.subject.toLowerCase().trim())) return false;

        if (activeFilters.applyDateStart) {
            if (safeDate(item.applyTime).getTime() < new Date(activeFilters.applyDateStart).getTime()) return false;
        }
        if (activeFilters.applyDateEnd) {
            const end = new Date(activeFilters.applyDateEnd);
            end.setHours(23, 59, 59, 999);
            if (safeDate(item.applyTime).getTime() > end.getTime()) return false;
        }
        return true;
    });

    return result.sort((a, b) => {
        const comparison = compareValues(a[sortField], b[sortField]);
        return sortDir === 'asc' ? comparison : -comparison;
    });
  }, [data, activeFilters, sortField, sortDir, isReady]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedData = filteredData.slice(startIndex, startIndex + itemsPerPage);

  const getStatusColor = (status: ApprovalStatus) => {
    switch(status) {
      case ApprovalStatus.APPROVED: return 'bg-emerald-100 text-emerald-800';
      case ApprovalStatus.PENDING: return 'bg-amber-100 text-amber-800';
      case ApprovalStatus.RETURNED: return 'bg-orange-100 text-orange-800';
      case ApprovalStatus.REJECTED: return 'bg-red-100 text-red-800';
      case ApprovalStatus.CANCELLED: return 'bg-slate-200 text-slate-600';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const columns = [
    { key: 'formId', label: '表單編號' },
    { key: 'formName', label: '表單名稱' },
    { key: 'subject', label: '主旨' },
    { key: 'applicantName', label: '申請人' },
    { key: 'approvalStatus', label: '狀態' },
    { key: 'currentApprover', label: '簽核者' },
    { key: 'applyTime', label: '申請時間' },
    { key: 'durationDisplay', label: '停留' },
  ];

  if (!isReady) {
      return (
          <div className="flex flex-col items-center justify-center h-96 bg-white rounded-xl shadow-sm border border-slate-200">
              <Loader2 size={40} className="text-indigo-600 animate-spin mb-4"/>
              <p className="text-slate-500">正在準備資料列表...</p>
          </div>
      );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col h-full animate-fade-in relative">
      <div className="p-5 border-b border-slate-200 bg-white space-y-4 z-20">
        <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Search className="text-indigo-600"/> 詳細記錄查詢</h3>
            <PageHelp 
                title="資料列表說明"
                description="提供所有表單歷程的原始明細資料，支援多維度的複合查詢與排序。"
                tips={[
                    "點擊標題欄位可以進行排序（例如按「申請時間」新到舊）。",
                    "輸入框支援即時搜尋，多選選單可選取多個條件。",
                    "若資料量過大，可善用日期篩選來縮小範圍。"
                ]}
            />
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500 ml-1">狀態</label>
                <MultiSelect 
                   options={allStatusOptions}
                   selected={inputState.status}
                   onChange={(val) => handleMultiSelectChange('status', val)}
                   placeholder="全部"
                />
            </div>
            <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500 ml-1">表單名稱</label>
                <MultiSelect 
                   options={uniqueFormNames}
                   selected={inputState.formName}
                   onChange={(val) => handleMultiSelectChange('formName', val)}
                   placeholder="全部"
                />
            </div>
            <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500 ml-1">表單編號</label>
                <input type="text" value={inputState.formId} onChange={(e) => setInputState(p => ({...p, formId: e.target.value}))} className="w-full text-xs border border-slate-300 rounded-lg px-2 py-2 bg-white text-slate-900 h-[38px]" placeholder="編號..." />
            </div>
            <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500 ml-1">申請人</label>
                <input type="text" value={inputState.applicant} onChange={(e) => setInputState(p => ({...p, applicant: e.target.value}))} className="w-full text-xs border border-slate-300 rounded-lg px-2 py-2 bg-white text-slate-900 h-[38px]" placeholder="姓名..." />
            </div>
            <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500 ml-1">簽核者</label>
                <input type="text" value={inputState.approver} onChange={(e) => setInputState(p => ({...p, approver: e.target.value}))} className="w-full text-xs border border-slate-300 rounded-lg px-2 py-2 bg-white text-slate-900 h-[38px]" placeholder="姓名..." />
            </div>
            <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500 ml-1">主旨</label>
                <input type="text" value={inputState.subject} onChange={(e) => setInputState(p => ({...p, subject: e.target.value}))} className="w-full text-xs border border-slate-300 rounded-lg px-2 py-2 bg-white text-slate-900 h-[38px]" placeholder="主旨..." />
            </div>
        </div>
      </div>

      <div className="overflow-x-auto flex-1 relative min-h-[400px]">
        {isPending && (
            <div className="absolute inset-0 bg-white/60 z-30 flex items-center justify-center">
                <div className="flex flex-col items-center p-4 bg-white shadow-lg rounded-xl border border-slate-100">
                    <Loader2 className="animate-spin text-indigo-600 mb-2" size={32} />
                    <span className="text-sm font-medium text-indigo-700">正在處理數據...</span>
                </div>
            </div>
        )}
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200 sticky top-0 z-10 select-none shadow-sm">
            <tr>
              {columns.map(col => (
                <th key={col.key} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100" onClick={() => handleSort(col.key as keyof ProjectTask)}>
                   <div className="flex items-center gap-1">{col.label} <ArrowUpDown size={12} className={sortField === col.key ? 'text-indigo-600' : 'text-slate-300'} /></div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedData.map((task, idx) => (
              <tr key={`${task.formId}-${idx}`} className={`border-b border-slate-100 hover:bg-slate-50 ${task.isAccountExpired && (task.approvalStatus === ApprovalStatus.PENDING || task.approvalStatus === ApprovalStatus.RETURNED) ? 'bg-purple-50' : 'bg-white'}`}>
                <td className="px-4 py-3 font-medium text-slate-900">{task.formId}</td>
                <td className="px-4 py-3 text-slate-500 whitespace-normal break-words max-w-[150px]">{task.formName}</td>
                <td className="px-4 py-3 text-slate-600 whitespace-normal break-words max-w-[200px]" title={task.subject}>{task.subject}</td>
                <td className="px-4 py-3 text-slate-900">
                    <div>
                        <div className="font-medium">{task.applicantName}</div>
                        {task.applicantAccount && <div className="text-[11px] text-slate-400">{task.applicantAccount}</div>}
                        <div className="text-[11px] text-slate-400">{task.applicantDept}</div>
                    </div>
                </td>
                <td className="px-4 py-3">
                   <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getStatusColor(task.approvalStatus)}`}>{task.approvalStatus}</span>
                </td>
                <td className="px-4 py-3 text-slate-500">
                    <div className="flex flex-col">
                        <div className="font-medium text-slate-800">{task.currentApprover}</div>
                        {task.currentApprover !== '-' && (
                            <>
                                {task.currentApproverAccount && <div className="text-[11px] text-slate-400">{task.currentApproverAccount}</div>}
                                {task.currentApproverDept && <div className="text-[11px] text-slate-400">{task.currentApproverDept}</div>}
                            </>
                        )}
                        {task.isAccountExpired && (task.approvalStatus === ApprovalStatus.PENDING || task.approvalStatus === ApprovalStatus.RETURNED) && (
                            <span className="text-[10px] text-red-500 font-bold mt-0.5">⚠️ 帳號已到期</span>
                        )}
                    </div>
                </td>
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{new Date(task.applyTime).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-slate-600 font-mono">{task.durationDisplay}</td>
              </tr>
            ))}
            {paginatedData.length === 0 && <tr><td colSpan={8} className="px-6 py-16 text-center text-slate-500">無資料</td></tr>}
          </tbody>
        </table>
      </div>
      
      <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center z-20">
         <select value={itemsPerPage} onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }} className="text-xs border p-1 rounded bg-white text-slate-900">
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
         </select>
         <div className="flex gap-2">
            <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="p-1 border rounded bg-white disabled:opacity-50"><ChevronLeft size={16}/></button>
            <span className="text-xs self-center">{currentPage} / {totalPages}</span>
            <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="p-1 border rounded bg-white disabled:opacity-50"><ChevronRight size={16}/></button>
         </div>
      </div>
    </div>
  );
};

export default DataTable;
