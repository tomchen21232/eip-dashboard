
import React, { useMemo, useState, useEffect, useRef, useTransition } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, 
  ComposedChart, Area, Legend
} from 'recharts';
import { ProjectTask, ApprovalStatus } from '../types';
import { 
  CheckCircle, AlertTriangle, FileText, Hourglass, 
  X, ChevronRight, Sparkles, Loader2, List, Timer,
  ArrowUpDown, ChevronLeft, ChevronRight as ChevronRightIcon, TrendingUp,
  Activity, Search, ChevronDown, UserX, Check, Filter, BarChart2
} from 'lucide-react';
import { generateTaskSummary } from '../services/geminiService';
import { MultiSelect } from './MultiSelect';
import { PageHelp } from './PageHelp';

interface DashboardProps {
  data: ProjectTask[];
}

const safeDate = (dateStr: string) => {
  if (!dateStr) return new Date();
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date() : d;
};

// Helper to safely find min/max without Stack Overflow on large arrays
const safeMin = (arr: number[]) => {
  if (arr.length === 0) return 0;
  let min = Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] < min) min = arr[i];
  }
  return min;
};

const formatStayTime = (seconds: number) => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}天 ${h}時 ${m}分`;
};

type DrillDownCategory = 'KPI' | 'FORM_NAME';
type DrillDownStatus = 'PENDING' | 'DELAYED' | 'EXPIRED' | 'COMPLETED' | 'ALL';
type DrillDownSortKey = 'formId' | 'status' | 'duration';
interface DrillDownSortConfig { key: DrillDownSortKey; direction: 'asc' | 'desc'; }

interface DrillDownFilters {
  status: string[]; // Changed to Array
  formId: string;
  formName: string[]; // Changed to Array
  approver: string;
  subject: string;
  applyDateStart: string;
  applyDateEnd: string;
  stepDateStart: string;
  stepDateEnd: string;
}

interface DrillDownState {
  isOpen: boolean;
  category: DrillDownCategory;
  filterValue: string | null; 
  originStatus: DrillDownStatus; 
  title: string;
}

type FormSortType = 'AVG_DESC' | 'AVG_ASC' | 'TOTAL_DESC' | 'TOTAL_ASC';

interface TrendContext {
  type: 'AVG_DURATION_GLOBAL' | 'AVG_DURATION_FORM' | 'APPLICATION_VOLUME';
  value: string; // 'ALL' or Form Name
}

const Dashboard: React.FC<DashboardProps> = ({ data }) => {
  const [isPending, startTransition] = useTransition(); // Performance Optimization
  
  const [drillDown, setDrillDown] = useState<DrillDownState>({
    isOpen: false,
    category: 'KPI',
    filterValue: null,
    originStatus: 'ALL',
    title: ''
  });

  const [activeFilters, setActiveFilters] = useState<DrillDownFilters>({
    status: [], formId: '', formName: [], approver: '', subject: '',
    applyDateStart: '', applyDateEnd: '', stepDateStart: '', stepDateEnd: ''
  });

  const [drillDownSort, setDrillDownSort] = useState<DrillDownSortConfig>({ key: 'duration', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [formSort, setFormSort] = useState<FormSortType>('AVG_DESC');
  const [hideZeroPending, setHideZeroPending] = useState(true);
  
  // Multi-Select for Analysis
  const [selectedFormsAnalysis, setSelectedFormsAnalysis] = useState<string[]>([]);
  
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [yearFilterForms, setYearFilterForms] = useState<string[]>([]); // Multi-Select

  const [trendContext, setTrendContext] = useState<TrendContext | null>(null);
  const [trendStartDate, setTrendStartDate] = useState('');
  const [trendEndDate, setTrendEndDate] = useState('');
  const [trendFilterForms, setTrendFilterForms] = useState<string[]>([]); // Multi-Select
  const [trendFilterStatus, setTrendFilterStatus] = useState<string[]>([]); // Multi-Select

  const [aiSummaries, setAiSummaries] = useState<Record<string, string>>({});
  const [loadingAi, setLoadingAi] = useState<Record<string, boolean>>({});

  // -- 1. Data Processing --
  const uniqueTasks = useMemo(() => {
    const groups: Record<string, ProjectTask[]> = {};
    data.forEach(task => {
      if (!task.formId) return;
      if (!groups[task.formId]) groups[task.formId] = [];
      groups[task.formId].push(task);
    });

    return Object.values(groups).map(logs => {
      const chronologicallySorted = [...logs].sort((a, b) => 
        safeDate(a.stepStartTime).getTime() - safeDate(b.stepStartTime).getTime()
      );
      
      const firstLog = chronologicallySorted[0];
      const latestLog = chronologicallySorted[chronologicallySorted.length - 1];
      const activeLog = logs.find(l => !l.stepEndTime);

      const findValue = <K extends keyof ProjectTask>(key: K): ProjectTask[K] | undefined => {
        for (const log of chronologicallySorted) {
           const val = log[key];
           if (val !== undefined && val !== null && val !== '' && val !== 0) return val;
        }
        return undefined;
      };

      const validSubject = findValue('subject') as string || '';
      const validFormCategory = findValue('formName') as string || '一般表單';
      const validApplicantDept = findValue('applicantDept') as string || '';

      // 1. 取得最終主表狀態
      let effectiveMainStatus = '';
      for (let i = chronologicallySorted.length - 1; i >= 0; i--) {
        if (chronologicallySorted[i].mainStatus) {
            effectiveMainStatus = chronologicallySorted[i].mainStatus;
            break;
        }
      }

      // 2. 核心判定規則修正
      // 主表狀態關鍵字：結案、核准、完成、不同意、退回、作廢
      const isMainClosed = ["結案", "核准", "完成", "不同意", "退回", "作廢"].some(s => effectiveMainStatus.includes(s)) && !effectiveMainStatus.includes('中');
      const hasVeto = logs.some(l => l.approvalStatus === ApprovalStatus.REJECTED || (l.mainStatus && l.mainStatus.includes('否決')));
      const hasCancel = logs.some(l => l.approvalStatus === ApprovalStatus.CANCELLED || (l.mainStatus && (l.mainStatus.includes('撤銷') || l.mainStatus.includes('作廢'))));

      let finalStatus = ApprovalStatus.PENDING;
      if (isMainClosed) {
          if (hasCancel) finalStatus = ApprovalStatus.CANCELLED;
          else if (hasVeto) finalStatus = ApprovalStatus.REJECTED;
          else finalStatus = ApprovalStatus.APPROVED;
      } else {
          // 若主狀態仍是簽核中，但歷程中已有作廢或否決，應優先判定為結案
          if (hasCancel) finalStatus = ApprovalStatus.CANCELLED;
          else if (hasVeto) finalStatus = ApprovalStatus.REJECTED;
          else finalStatus = ApprovalStatus.PENDING;
      }

      const currentApprover = activeLog ? activeLog.currentApprover : latestLog.currentApprover;

      const applyTime = safeDate(firstLog.applyTime).getTime();
      let endTime = new Date().getTime();
      if (finalStatus !== ApprovalStatus.PENDING) {
         let maxTime = applyTime; 
         logs.forEach(l => {
            const startT = safeDate(l.stepStartTime).getTime();
            const endT = l.stepEndTime ? safeDate(l.stepEndTime).getTime() : 0;
            if (startT > maxTime) maxTime = startT;
            if (endT > maxTime) maxTime = endT;
         });
         endTime = maxTime;
      }

      const totalDurationSeconds = Math.floor((endTime - applyTime) / 1000);
      let stayTimeSeconds = 0;
      if (finalStatus === ApprovalStatus.PENDING) {
        if (activeLog && !latestLog.stepEndTime) {
           stayTimeSeconds = Math.floor((new Date().getTime() - safeDate(activeLog.stepStartTime).getTime()) / 1000);
        } else {
           stayTimeSeconds = Math.floor((new Date().getTime() - safeDate(latestLog.stepStartTime).getTime()) / 1000);
        }
      } else {
         stayTimeSeconds = totalDurationSeconds;
      }
      if (stayTimeSeconds < 0) stayTimeSeconds = 0;

      let isExpired = false;
      const now = new Date();
      if (activeLog && activeLog.approverExpiryDate) {
         const exp = new Date(activeLog.approverExpiryDate);
         if (!isNaN(exp.getTime()) && exp < now) isExpired = true;
      }

      return {
        ...latestLog, 
        formName: validFormCategory, 
        applicantDept: validApplicantDept,
        applicantName: firstLog.applicantName,
        applicantAccount: firstLog.applicantAccount,
        subject: validSubject,
        approvalStatus: finalStatus,
        currentApprover: currentApprover || '-', 
        durationSeconds: totalDurationSeconds,
        stayTimeSeconds: stayTimeSeconds, 
        durationDisplay: formatStayTime(stayTimeSeconds),
        applyTime: firstLog.applyTime,
        stepStartTime: latestLog.stepStartTime,
        calculatedEndTime: endTime,
        isAccountExpired: isExpired 
      };
    });
  }, [data]);

  const uniqueFormNames = useMemo(() => {
    const names = new Set(uniqueTasks.map(t => t.formName).filter(Boolean));
    return Array.from(names).sort();
  }, [uniqueTasks]);

  const allStatusOptions = Object.values(ApprovalStatus);

  // -- Metrics --
  const metrics = useMemo(() => {
    const total = uniqueTasks.length;
    const pendingTasks = uniqueTasks.filter(t => t.approvalStatus === ApprovalStatus.PENDING || t.approvalStatus === ApprovalStatus.RETURNED);
    const pending = pendingTasks.length;
    const delayed = pendingTasks.filter(t => t.durationSeconds > 60 * 86400).length;
    
    const expiredCount = pendingTasks.filter(t => t.isAccountExpired).length;

    const completedTasks = uniqueTasks.filter(t => t.approvalStatus !== ApprovalStatus.PENDING && t.approvalStatus !== ApprovalStatus.RETURNED);
    const avgSec = completedTasks.length > 0 
      ? completedTasks.reduce((acc, t) => acc + t.durationSeconds, 0) / completedTasks.length 
      : 0;
    const avgDays = (avgSec / 86400).toFixed(1);
    const completionRate = total > 0 ? Math.round((completedTasks.length / total) * 100) : 0;

    const now = new Date();
    const thisMonthCount = uniqueTasks.filter(t => {
        const d = safeDate(t.applyTime);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;

    return { total, pending, delayed, expiredCount, avgDays, completionRate, thisMonthCount };
  }, [uniqueTasks]);

  // -- Trend Data --
  const trendData = useMemo(() => {
     if (!trendContext) return { data: [], totalCount: 0, avgDays: 0 };

     let filteredForTrend = uniqueTasks;
     
     // Filter by Selected Forms (Multi-Select)
     if (trendFilterForms.length > 0) {
         filteredForTrend = filteredForTrend.filter(t => trendFilterForms.includes(t.formName));
     } else if (trendContext.type === 'AVG_DURATION_FORM' && trendContext.value !== 'ALL') {
         // Fallback if no filter but context set
         filteredForTrend = filteredForTrend.filter(t => t.formName === trendContext.value);
     }

     // Filter by Status (Multi-Select)
     if (trendFilterStatus.length > 0) {
        filteredForTrend = filteredForTrend.filter(t => trendFilterStatus.includes(t.approvalStatus));
     }

     let minTime = new Date(2023,0,1).getTime(); 
     let maxTime = new Date().getTime(); 

     if (trendStartDate) minTime = new Date(trendStartDate).getTime();
     else {
         const allDates = filteredForTrend.map(t => trendContext.type === 'APPLICATION_VOLUME' ? safeDate(t.applyTime).getTime() : t.calculatedEndTime);
         if(allDates.length > 0) minTime = safeMin(allDates);
     }

     if (trendEndDate) {
         const e = new Date(trendEndDate);
         e.setHours(23, 59, 59, 999);
         maxTime = e.getTime();
     }
     
     if (minTime > maxTime) return { data: [], totalCount: 0, avgDays: 0 };
     const startDate = new Date(minTime);
     const endDate = new Date(maxTime);

     // AVG Duration Trend
     if (trendContext.type.startsWith('AVG_DURATION')) {
        const closedTasks = filteredForTrend.filter(t => t.approvalStatus !== ApprovalStatus.PENDING && t.approvalStatus !== ApprovalStatus.RETURNED);
        if (closedTasks.length === 0) return { data: [], totalCount: 0, avgDays: 0 };

        const months = [];
        let currentIterator = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
        const endIterator = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

        // Sum of all items in the visible range
        let rangeTotalCount = 0;
        let rangeTotalDuration = 0;

        while (currentIterator <= endIterator) {
            const year = currentIterator.getFullYear();
            const month = currentIterator.getMonth();
            const startT = new Date(year, month, 1, 0, 0, 0).getTime();
            const endT = new Date(year, month + 1, 0, 23, 59, 59).getTime();

            const tasksInMonth = closedTasks.filter(t => t.calculatedEndTime >= startT && t.calculatedEndTime <= endT);
            const count = tasksInMonth.length;
            const durationSum = count > 0 ? tasksInMonth.reduce((acc, t) => acc + t.durationSeconds, 0) : 0;
            const avgSec = count > 0 ? durationSum / count : 0;
            
            rangeTotalCount += count;
            rangeTotalDuration += durationSum;

            months.push({
                name: `${year}-${(month + 1).toString().padStart(2, '0')}`,
                avgDays: parseFloat((avgSec / 86400).toFixed(1)),
                totalCount: count,
                tooltipLabel: `${year}年${month+1}月`
            });
            currentIterator.setMonth(currentIterator.getMonth() + 1);
        }
        
        const rangeAvgDays = rangeTotalCount > 0 ? (rangeTotalDuration / rangeTotalCount / 86400).toFixed(1) : '0.0';
        return { data: months, totalCount: rangeTotalCount, avgDays: parseFloat(rangeAvgDays) };
     }

     // Application Volume Trend
     if (trendContext.type === 'APPLICATION_VOLUME') {
        const months = [];
        let currentIterator = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
        const endIterator = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
        let rangeTotalCount = 0;
        let rangeTotalDuration = 0;

        while (currentIterator <= endIterator) {
            const year = currentIterator.getFullYear();
            const month = currentIterator.getMonth();
            const startT = new Date(year, month, 1, 0, 0, 0).getTime();
            const endT = new Date(year, month + 1, 0, 23, 59, 59).getTime();
            const tasks = filteredForTrend.filter(t => {
                const tt = safeDate(t.applyTime).getTime();
                return tt >= startT && tt <= endT;
            });
            rangeTotalCount += tasks.length;
            
            // Calculate total duration for these specific tasks found in range
            const durationSum = tasks.length > 0 ? tasks.reduce((acc, t) => acc + t.durationSeconds, 0) : 0;
            rangeTotalDuration += durationSum;

            months.push({
                name: `${year}-${(month + 1).toString().padStart(2, '0')}`,
                totalCount: tasks.length,
                tooltipLabel: `${year}年${month+1}月`
            });
            currentIterator.setMonth(currentIterator.getMonth() + 1);
        }
        
        const rangeAvgDays = rangeTotalCount > 0 ? (rangeTotalDuration / rangeTotalCount / 86400).toFixed(1) : '0.0';
        return { data: months, totalCount: rangeTotalCount, avgDays: parseFloat(rangeAvgDays) };
     }
     return { data: [], totalCount: 0, avgDays: 0 };
  }, [uniqueTasks, trendContext, trendStartDate, trendEndDate, trendFilterForms, trendFilterStatus]);

  // -- Form Stats --
  const formStats = useMemo(() => {
    const stats: Record<string, { pending: number, completed: number, totalDuration: number, completedCount: number }> = {};
    uniqueTasks.forEach(t => {
      const name = t.formName || '其他';
      // Apply Multi-select filter if active
      if (selectedFormsAnalysis.length > 0 && !selectedFormsAnalysis.includes(name)) return;
      
      if (!stats[name]) stats[name] = { pending: 0, completed: 0, totalDuration: 0, completedCount: 0 };
      if (t.approvalStatus === ApprovalStatus.PENDING || t.approvalStatus === ApprovalStatus.RETURNED) {
        stats[name].pending++;
      } else {
        stats[name].completed++;
        stats[name].totalDuration += t.durationSeconds;
        stats[name].completedCount++;
      }
    });
    
    const list = Object.keys(stats).map(name => {
      const s = stats[name];
      const total = s.pending + s.completed;
      const avgDays = s.completedCount > 0 ? (s.totalDuration / s.completedCount / 86400).toFixed(1) : '0.0';
      return { 
        name, 
        pending: s.pending, 
        completed: s.completed, 
        total, 
        pendingPct: total ? Math.round((s.pending/total)*100) : 0,
        avgDays: parseFloat(avgDays)
      };
    });
    return [...list].sort((a, b) => {
        switch(formSort) {
            case 'AVG_DESC': return b.avgDays - a.avgDays;
            case 'AVG_ASC': return a.avgDays - b.avgDays;
            case 'TOTAL_DESC': return b.total - a.total;
            case 'TOTAL_ASC': return a.total - b.total;
            default: return b.avgDays - a.avgDays;
        }
    });
  }, [uniqueTasks, formSort, selectedFormsAnalysis]);

  // -- Annual Trend Data --
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    uniqueTasks.forEach(t => {
        const d = safeDate(t.applyTime);
        if (!isNaN(d.getTime())) years.add(d.getFullYear());
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [uniqueTasks]);

  const annualStatsResult = useMemo(() => {
    const stats = Array.from({ length: 12 }, (_, i) => ({ name: `${i + 1}月`, count: 0 }));
    let totalInYear = 0;
    uniqueTasks.forEach(t => {
      if (yearFilterForms.length > 0 && !yearFilterForms.includes(t.formName)) return;
      const d = safeDate(t.applyTime);
      if (d.getFullYear() === selectedYear) {
          stats[d.getMonth()].count++;
          totalInYear++;
      }
    });
    return { data: stats, total: totalInYear };
  }, [uniqueTasks, selectedYear, yearFilterForms]);


  // -- Drill Down Data Logic (With useTransition for Performance) --
  const drillDownData = useMemo(() => {
    if (!drillDown.isOpen) return [];

    let list = uniqueTasks;

    // Base Filter from where we clicked
    if (drillDown.category === 'FORM_NAME') {
      list = list.filter(t => t.formName === drillDown.filterValue);
    } 

    if (drillDown.originStatus === 'DELAYED') {
         list = list.filter(t => (t.approvalStatus === ApprovalStatus.PENDING || t.approvalStatus === ApprovalStatus.RETURNED) && t.durationSeconds > 60 * 86400);
    } else if (drillDown.originStatus === 'PENDING') {
         list = list.filter(t => t.approvalStatus === ApprovalStatus.PENDING || t.approvalStatus === ApprovalStatus.RETURNED);
    } else if (drillDown.originStatus === 'COMPLETED') {
         list = list.filter(t => t.approvalStatus !== ApprovalStatus.PENDING && t.approvalStatus !== ApprovalStatus.RETURNED);
    } else if (drillDown.originStatus === 'EXPIRED') {
         list = list.filter(t => t.isAccountExpired && (t.approvalStatus === ApprovalStatus.PENDING || t.approvalStatus === ApprovalStatus.RETURNED));
    }

    // Interactive Filters
    if (activeFilters.status.length > 0) list = list.filter(t => activeFilters.status.includes(t.approvalStatus));
    if (activeFilters.formName.length > 0) list = list.filter(t => activeFilters.formName.includes(t.formName));
    
    if (activeFilters.formId.trim()) list = list.filter(t => t.formId.toLowerCase().includes(activeFilters.formId.trim().toLowerCase()));
    if (activeFilters.approver.trim()) list = list.filter(t => t.currentApprover.toLowerCase().includes(activeFilters.approver.toLowerCase().trim()));
    if (activeFilters.subject.trim()) list = list.filter(t => t.subject.toLowerCase().includes(activeFilters.subject.toLowerCase().trim()));

    if (activeFilters.applyDateStart) {
        const start = new Date(activeFilters.applyDateStart).getTime();
        list = list.filter(t => safeDate(t.applyTime).getTime() >= start);
    }
    if (activeFilters.applyDateEnd) {
        const end = new Date(activeFilters.applyDateEnd);
        end.setHours(23, 59, 59, 999);
        list = list.filter(t => safeDate(t.applyTime).getTime() <= end.getTime());
    }
    
    return [...list].sort((a, b) => {
        let valA: any, valB: any;
        switch(drillDownSort.key) {
            case 'formId': valA = a.formId; valB = b.formId; break;
            case 'status': valA = a.approvalStatus; valB = b.approvalStatus; break;
            case 'duration': default: valA = a.stayTimeSeconds || 0; valB = b.stayTimeSeconds || 0; break;
        }
        if (valA < valB) return drillDownSort.direction === 'asc' ? -1 : 1;
        if (valA > valB) return drillDownSort.direction === 'asc' ? 1 : -1;
        return 0;
    });

  }, [drillDown, activeFilters, drillDownSort, uniqueTasks]);

  const openDrillDown = (category: DrillDownCategory, value: string | null, status: DrillDownStatus, title: string) => {
    let initialStatus: string[] = [];
    if (status === 'PENDING') initialStatus = [ApprovalStatus.PENDING, ApprovalStatus.RETURNED];
    else if (status === 'COMPLETED') initialStatus = [ApprovalStatus.APPROVED, ApprovalStatus.REJECTED, ApprovalStatus.CANCELLED];

    const emptyFilters = {
        status: initialStatus, formId: '', formName: [], approver: '', subject: '',
        applyDateStart: '', applyDateEnd: '', stepDateStart: '', stepDateEnd: ''
    };
    setActiveFilters(emptyFilters);
    setDrillDown({ isOpen: true, category, filterValue: value, originStatus: (status === 'PENDING' || status === 'COMPLETED') ? 'ALL' : status, title });
    setCurrentPage(1);
  };

  const updateFilters = (key: keyof DrillDownFilters, value: any) => {
      startTransition(() => {
          setActiveFilters(prev => ({ ...prev, [key]: value }));
          setCurrentPage(1);
      });
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

  const paginatedDrillDownData = drillDownData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.ceil(drillDownData.length / itemsPerPage);

  const SortIcon = ({ sortKey }: { sortKey: DrillDownSortKey }) => (
    <ArrowUpDown size={12} className={`ml-1 ${drillDownSort.key === sortKey ? 'text-indigo-600' : 'text-slate-300'}`} />
  );

  return (
    <div className="space-y-6 pb-12 relative animate-fade-in">
      
      <div className="flex justify-between items-end gap-6">
        <h2 className="text-xl font-bold text-slate-800">全表單監控儀表板</h2>
        <PageHelp 
            title="儀表板使用說明"
            description="本儀表板提供所有表單申請的宏觀數據，協助管理者快速掌握整體運作健康度。點擊 KPI 卡片或圖表可進入詳細資料列表。"
            metrics={[
                { label: "總申請案件", desc: "所有已匯入資料的案件總數（包含進行中與已結案）。" },
                { label: "帳號已到期", desc: "目前簽核者帳號已失效的案件，需優先處理以免流程卡住。" },
                { label: "嚴重延遲", desc: "申請至今超過 60 天仍未結案的表單。" },
                { label: "平均結案時間", desc: "所有「已核准」案件從申請到結案的平均天數。" }
            ]}
            tips={[
                "點擊上方的六個 KPI 卡片，可以直接篩選出符合該條件的詳細清單。",
                "可以使用右上方的「篩選分析表單」來只看特定類型的表單數據。",
                "「年度申請趨勢」可切換不同年份，觀察業務量的季節性變化。"
            ]}
        />
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <div onClick={() => openDrillDown('KPI', null, 'ALL', '總申請案件')} className="bg-white p-4 rounded-xl shadow-sm border-l-4 border-slate-400 cursor-pointer hover:shadow-md transition-all group relative">
              <div className="absolute top-4 right-4 p-1.5 bg-slate-100 rounded-full text-slate-400"><FileText size={18} /></div>
              <div>
                <div className="flex items-center gap-1 mb-1"><p className="text-xs text-slate-500 font-medium">總申請案件</p><ChevronRightIcon size={12} className="text-slate-300" /></div>
                <p className="text-2xl font-bold text-slate-800 mt-2">{metrics.total.toLocaleString()}</p>
                <div className="mt-1 text-[10px] text-slate-400">結案率 {metrics.completionRate}%</div>
              </div>
            </div>
            
             {/* Application Trend KPI Card */}
            <div onClick={() => { setTrendContext({ type: 'APPLICATION_VOLUME', value: 'ALL' }); setTrendFilterForms([]); setTrendFilterStatus([]); }} className="bg-white p-4 rounded-xl shadow-sm border-l-4 border-blue-500 cursor-pointer hover:shadow-md transition-all group relative">
              <div className="absolute top-4 right-4 p-1.5 bg-blue-100 rounded-full text-blue-600"><BarChart2 size={18} /></div>
              <div>
                <div className="flex items-center gap-1 mb-1"><p className="text-xs text-slate-500 font-medium">申請案件趨勢</p><TrendingUp size={12} className="text-slate-300 group-hover:text-blue-500" /></div>
                <p className="text-xl font-bold text-blue-600 mt-2">查看分析</p>
                <p className="text-[10px] text-slate-400 mt-1 group-hover:text-blue-600">依申請日期統計</p>
              </div>
            </div>

            <div onClick={() => openDrillDown('KPI', null, 'EXPIRED', '帳號已到期案件')} className="bg-white p-4 rounded-xl shadow-sm border-l-4 border-purple-500 cursor-pointer hover:shadow-md transition-all group relative">
              <div className="absolute top-4 right-4 p-1.5 bg-purple-100 rounded-full text-purple-600"><UserX size={18} /></div>
              <div>
                <div className="flex items-center gap-1 mb-1"><p className="text-xs text-slate-500 font-medium">帳號已到期</p><ChevronRightIcon size={12} className="text-slate-300 group-hover:text-purple-500" /></div>
                <p className="text-2xl font-bold text-purple-600 mt-2">{metrics.expiredCount.toLocaleString()}</p>
                <div className="mt-1 text-[10px] text-slate-400">目前簽核人失效</div>
              </div>
            </div>

            <div onClick={() => openDrillDown('KPI', null, 'PENDING', '進行中案件')} className="bg-white p-4 rounded-xl shadow-sm border-l-4 border-amber-500 cursor-pointer hover:shadow-md transition-all group relative">
              <div className="absolute top-4 right-4 p-1.5 bg-amber-100 rounded-full text-amber-600"><Hourglass size={18} /></div>
              <div>
                <div className="flex items-center gap-1 mb-1"><p className="text-xs text-slate-500 font-medium">進行中案件</p><ChevronRightIcon size={12} className="text-slate-300 group-hover:text-amber-500" /></div>
                <p className="text-2xl font-bold text-amber-500 mt-1">{metrics.pending.toLocaleString()}</p>
              </div>
            </div>

            <div onClick={() => openDrillDown('KPI', null, 'DELAYED', '嚴重延遲案件')} className="bg-white p-4 rounded-xl shadow-sm border-l-4 border-red-500 cursor-pointer hover:shadow-md transition-all group relative">
              <div className="absolute top-4 right-4 p-1.5 bg-red-100 rounded-full text-red-600"><AlertTriangle size={18} /></div>
              <div>
                <div className="flex items-center gap-1 mb-1"><p className="text-xs text-slate-500 font-medium">嚴重延遲 {'>'}60天</p><ChevronRightIcon size={12} className="text-slate-300 group-hover:text-red-500" /></div>
                <p className="text-2xl font-bold text-red-500 mt-1">{metrics.delayed.toLocaleString()}</p>
              </div>
            </div>

            <div onClick={() => { setTrendContext({ type: 'AVG_DURATION_GLOBAL', value: 'ALL' }); setTrendFilterForms([]); setTrendFilterStatus([]); }} className="bg-white p-4 rounded-xl shadow-sm border-l-4 border-emerald-500 cursor-pointer hover:shadow-md transition-all group relative">
              <div className="absolute top-4 right-4 p-1.5 bg-emerald-100 rounded-full text-emerald-600"><CheckCircle size={18} /></div>
              <div>
                <div className="flex items-center gap-1 mb-1"><p className="text-xs text-slate-500 font-medium">平均結案時間</p><TrendingUp size={12} className="text-slate-300 group-hover:text-emerald-500" /></div>
                <p className="text-2xl font-bold text-slate-800 mt-2">{metrics.avgDays} <span className="text-xs font-normal">天</span></p>
                <p className="text-[10px] text-slate-400 mt-1 group-hover:text-emerald-600">點擊查看趨勢</p>
              </div>
            </div>
        </div>

       {/* Annual Trend Chart */}
       <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex flex-wrap gap-4 items-center justify-between">
           <div className="flex items-center gap-2">
             <div className="p-2 bg-blue-50 rounded-lg text-blue-600"><Activity size={20} /></div>
             <div>
                <h3 className="font-bold text-slate-800">年度申請趨勢</h3>
                <p className="text-xs text-slate-500 mt-0.5">總計: {annualStatsResult.total.toLocaleString()} 件</p>
             </div>
           </div>
           <div className="flex gap-3 items-center">
             <div className="w-48">
                <MultiSelect 
                   options={uniqueFormNames} 
                   selected={yearFilterForms} 
                   onChange={setYearFilterForms} 
                   placeholder="全部表單"
                />
             </div>
             <select 
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="text-sm border border-slate-300 rounded-md px-3 py-2 text-slate-700 bg-white"
             >
                {availableYears.map(y => <option key={y} value={y}>{y} 年</option>)}
             </select>
           </div>
        </div>
        <div className="p-6 h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={annualStatsResult.data} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
              <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }} />
              <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={40}>
                <LabelList dataKey="count" position="top" fill="#2563eb" fontSize={12} formatter={(v: number) => v > 0 ? v : ''} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="flex flex-col gap-4">
         <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex-wrap gap-3">
           <div className="flex items-center gap-2">
             <div className="p-2 bg-blue-50 rounded-lg text-blue-600"><List size={20} /></div>
             <h3 className="font-bold text-slate-800">各表單統計與效率分析</h3>
           </div>
           
           <div className="flex items-center gap-3 flex-wrap">
               {/* Multi-Select Form Filter */}
               <div className="w-48">
                   <MultiSelect 
                       options={uniqueFormNames}
                       selected={selectedFormsAnalysis}
                       onChange={setSelectedFormsAnalysis}
                       label=""
                       placeholder="篩選分析表單"
                   />
               </div>

               <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                  <input type="checkbox" checked={hideZeroPending} onChange={(e) => setHideZeroPending(e.target.checked)} className="rounded border-slate-300 text-indigo-600" />
                  隱藏進行中0
               </label>
               <select value={formSort} onChange={(e) => setFormSort(e.target.value as FormSortType)} className="text-xs border border-slate-200 rounded-md px-2 py-2 text-slate-900 bg-white max-w-[140px]">
                  <option value="AVG_DESC">平均時間 (高→低)</option>
                  <option value="AVG_ASC">平均時間 (低→高)</option>
                  <option value="TOTAL_DESC">總案件 (多→少)</option>
                  <option value="TOTAL_ASC">總案件 (少→多)</option>
               </select>
           </div>
         </div>
         
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 max-h-[800px] overflow-y-auto pr-2 custom-scrollbar">
            {formStats.filter(f => !hideZeroPending || f.pending > 0).map(form => (
              <div key={form.name} className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
                 <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500 opacity-80"></div>
                 <div className="flex justify-between items-start mb-3 pl-2">
                    <h4 className="font-bold text-base text-slate-800 line-clamp-2" title={form.name}>{form.name}</h4>
                    <button 
                       onClick={(e) => { e.stopPropagation(); setTrendContext({ type: 'AVG_DURATION_GLOBAL', value: form.name }); setTrendFilterForms([form.name]); setTrendFilterStatus([]); }}
                       className="flex-shrink-0 flex items-center gap-1 bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-xs font-bold border border-indigo-100 hover:bg-indigo-100"
                    >
                       <Timer size={12} /> {form.avgDays}天
                    </button>
                 </div>
                 <div className="pl-2 mb-3">
                    <div className="text-xs text-slate-500">總案件: <span className="font-semibold text-slate-700">{form.total.toLocaleString()}</span></div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1.5 flex">
                        <div style={{ width: `${form.pendingPct}%` }} className="bg-amber-400 h-full" />
                        <div style={{ width: `${100 - form.pendingPct}%` }} className="bg-emerald-500 h-full" />
                    </div>
                 </div>
                 <div className="flex gap-2 pl-2">
                    <button 
                       onClick={() => openDrillDown('FORM_NAME', form.name, 'PENDING', form.name)}
                       className="flex-1 py-1.5 rounded bg-amber-50 border border-amber-100 text-amber-700 text-xs font-bold hover:bg-amber-100 flex items-center justify-center gap-1"
                    >
                       <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div> 進行中 {form.pending}
                    </button>
                    <button 
                       onClick={() => openDrillDown('FORM_NAME', form.name, 'COMPLETED', form.name)}
                       className="flex-1 py-1.5 rounded bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-bold hover:bg-emerald-100 flex items-center justify-center gap-1"
                    >
                       <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> 已結案 {form.completed}
                    </button>
                 </div>
              </div>
            ))}
         </div>
      </div>
      
      {trendContext && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
           <div className="bg-white rounded-xl shadow-2xl w-full max-w-7xl flex flex-col animate-scale-in">
              <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50 rounded-t-xl">
                 <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <TrendingUp className="text-emerald-600" />
                    趨勢分析
                 </h3>
                 <button onClick={() => { setTrendContext(null); setTrendStartDate(''); setTrendEndDate(''); }} className="p-2 hover:bg-slate-200 rounded-full text-slate-500"><X size={20} /></button>
              </div>
              
              <div className="px-6 py-4 bg-white border-b border-slate-200 flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between z-50">
                   <div className="flex flex-col md:flex-row gap-4 w-full lg:w-auto">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-slate-500 whitespace-nowrap">日期:</span>
                            <div className="flex items-center gap-1 border border-slate-300 rounded px-2 py-1 bg-white">
                                <input type="date" value={trendStartDate} onChange={(e) => setTrendStartDate(e.target.value)} className="text-xs outline-none bg-transparent text-slate-900" />
                                <span className="text-slate-400">~</span>
                                <input type="date" value={trendEndDate} onChange={(e) => setTrendEndDate(e.target.value)} className="text-xs outline-none bg-transparent text-slate-900" />
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-slate-500 whitespace-nowrap">過濾:</span>
                            <div className="w-48">
                                <MultiSelect 
                                    options={uniqueFormNames}
                                    selected={trendFilterForms}
                                    onChange={setTrendFilterForms}
                                    placeholder="全部表單"
                                />
                            </div>
                            <div className="w-36">
                                <MultiSelect 
                                    options={allStatusOptions}
                                    selected={trendFilterStatus}
                                    onChange={setTrendFilterStatus}
                                    placeholder="全部狀態"
                                />
                            </div>
                        </div>
                   </div>

                   <div className="flex items-center gap-3 w-full lg:w-auto justify-end mt-2 lg:mt-0">
                       <div className="flex items-center px-4 py-2 bg-white border border-indigo-100 rounded-lg shadow-sm">
                           <span className="text-xs font-medium text-slate-500 mr-2">區間總件數</span>
                           <span className="text-lg font-bold text-indigo-600">{trendData.totalCount.toLocaleString()}</span>
                       </div>
                       <div className="flex items-center px-4 py-2 bg-white border border-emerald-100 rounded-lg shadow-sm">
                           <div className="bg-blue-600 text-white text-[10px] px-1 mr-2 rounded font-bold">區間平均天數</div>
                           <span className="text-lg font-bold text-emerald-600">{trendData.avgDays} <span className="text-xs text-emerald-400">天</span></span>
                       </div>
                   </div>
              </div>

              <div className="p-6 h-[400px]">
                 <ResponsiveContainer width="100%" height="100%">
                    {trendContext.type.startsWith('AVG_DURATION') ? (
                        <ComposedChart data={trendData.data}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} dy={10} />
                            <YAxis yAxisId="left" tick={{ fontSize: 12, fill: '#10b981' }} axisLine={false} tickLine={false} label={{ value: '平均天數', angle: -90, position: 'insideLeft' }} />
                            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12, fill: '#6366f1' }} axisLine={false} tickLine={false} label={{ value: '結案數', angle: 90, position: 'insideRight' }} />
                            <Tooltip labelFormatter={(l) => trendData.data.find(d => d.name === l)?.tooltipLabel || l} />
                            <Legend />
                            <Bar yAxisId="right" dataKey="totalCount" name="結案數量" fill="#6366f1" barSize={20} radius={[4, 4, 0, 0]} opacity={0.6} />
                            <Area yAxisId="left" type="monotone" dataKey="avgDays" name="平均天數" stroke="#10b981" fill="#10b981" fillOpacity={0.1} strokeWidth={3} />
                        </ComposedChart>
                    ) : (
                        <BarChart data={trendData.data}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                            <YAxis axisLine={false} tickLine={false} />
                            <Tooltip labelFormatter={(l) => trendData.data.find(d => d.name === l)?.tooltipLabel || l} />
                            <Bar dataKey="totalCount" name="申請數量" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    )}
                 </ResponsiveContainer>
              </div>
           </div>
        </div>
      )}

      {drillDown.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[95vh] flex flex-col animate-scale-in">
            <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50 rounded-t-xl">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><List className="text-indigo-600" /> {drillDown.title}</h3>
              <button onClick={() => setDrillDown(prev => ({ ...prev, isOpen: false }))} className="p-2 hover:bg-slate-200 rounded-full text-slate-500"><X size={20} /></button>
            </div>

            <div className="p-4 border-b border-slate-200 bg-white grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
                 <div>
                   <label className="text-xs font-medium text-slate-500 ml-1">目前狀態</label>
                   <MultiSelect 
                       options={allStatusOptions}
                       selected={activeFilters.status}
                       onChange={(val) => updateFilters('status', val)}
                       placeholder="全部狀態"
                   />
                 </div>
                 <div>
                   <label className="text-xs font-medium text-slate-500 ml-1">表單名稱 (類別)</label>
                   <MultiSelect 
                      options={uniqueFormNames} 
                      selected={activeFilters.formName}
                      onChange={(val) => updateFilters('formName', val)}
                      placeholder="全部表單"
                   />
                 </div>
                 <div>
                   <label className="text-xs font-medium text-slate-500 ml-1">表單編號</label>
                   <input type="text" value={activeFilters.formId} onChange={(e) => updateFilters('formId', e.target.value)} className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white text-slate-900 h-[38px]" placeholder="完整編號" />
                 </div>
                 <div>
                   <label className="text-xs font-medium text-slate-500 ml-1">目前簽核者</label>
                   <input type="text" value={activeFilters.approver} onChange={(e) => updateFilters('approver', e.target.value)} className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white text-slate-900 h-[38px]" placeholder="姓名關鍵字" />
                 </div>
                 <div>
                   <label className="text-xs font-medium text-slate-500 ml-1">主旨</label>
                   <input type="text" value={activeFilters.subject} onChange={(e) => updateFilters('subject', e.target.value)} className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white text-slate-900 h-[38px]" placeholder="主旨關鍵字" />
                 </div>
            </div>

            <div className="flex-1 overflow-auto p-0 relative min-h-[300px]">
              {isPending && (
                  <div className="absolute inset-0 bg-white/70 z-20 flex items-center justify-center">
                      <div className="flex flex-col items-center">
                        <Loader2 className="animate-spin text-indigo-600 mb-2" size={32} />
                        <span className="text-sm font-medium text-indigo-700">正在過濾資料...</span>
                      </div>
                  </div>
              )}
              <table className="w-full text-sm text-left table-fixed">
                <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-3 py-3 w-[40%] cursor-pointer hover:bg-slate-100" onClick={() => setDrillDownSort(p => ({ key: 'formId', direction: p.direction === 'asc' ? 'desc' : 'asc' }))}>表單資訊 <SortIcon sortKey="formId"/></th>
                    <th className="px-3 py-3 w-[20%] cursor-pointer hover:bg-slate-100" onClick={() => setDrillDownSort(p => ({ key: 'status', direction: p.direction === 'asc' ? 'desc' : 'asc' }))}>狀態 <SortIcon sortKey="status"/></th>
                    <th className="px-3 py-3 w-[15%] cursor-pointer hover:bg-slate-100" onClick={() => setDrillDownSort(p => ({ key: 'duration', direction: p.direction === 'asc' ? 'desc' : 'asc' }))}>停留 <SortIcon sortKey="duration"/></th>
                    <th className="px-3 py-3 w-[25%]">AI 摘要</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedDrillDownData.map(task => (
                    <tr key={task.formId} className={`hover:bg-slate-50 ${task.isAccountExpired && task.approvalStatus === ApprovalStatus.PENDING ? 'bg-purple-50 hover:bg-purple-100' : ''}`}>
                      <td className="px-3 py-3 align-top">
                         <div className="flex justify-between">
                            <span className="font-bold text-indigo-600">{task.formId}</span>
                            <span className="text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 whitespace-normal break-words max-w-[150px]">{task.formName}</span>
                         </div>
                         <div className="text-slate-800 font-medium mt-1 whitespace-normal break-words" title={task.subject}>{task.subject}</div>
                         <div className="mt-1.5 flex flex-col gap-0.5">
                            <div className="text-[11px] text-slate-500 font-medium flex items-center gap-1">
                                <span>申請人: {task.applicantName}</span>
                                {task.applicantAccount && <span className="text-slate-400 font-normal">({task.applicantAccount})</span>}
                            </div>
                            <div className="text-[10px] text-slate-400">{task.applicantDept}</div>
                         </div>
                         <div className="text-xs text-slate-400 mt-1">{safeDate(task.applyTime).toLocaleDateString()}</div>
                      </td>
                      <td className="px-3 py-3 align-top">
                         <div className="font-bold text-slate-700">{task.approvalStatus}</div>
                         <div className="text-xs text-slate-500 mt-1 flex flex-col">
                            <div className="font-medium text-slate-600">目前: {task.currentApprover}</div>
                            {task.currentApproverAccount && task.currentApprover !== '-' && <div className="text-[10px] text-slate-400">{task.currentApproverAccount}</div>}
                            {task.currentApproverDept && task.currentApprover !== '-' && <div className="text-[10px] text-slate-400">{task.currentApproverDept}</div>}
                            {task.isAccountExpired && (task.approvalStatus === ApprovalStatus.PENDING || task.approvalStatus === ApprovalStatus.RETURNED) && (
                                <span className="text-[10px] bg-red-100 text-red-600 px-1 rounded border border-red-200 mt-0.5 inline-block w-fit">帳號到期</span>
                            )}
                         </div>
                      </td>
                      <td className="px-3 py-3 align-top font-mono text-slate-600">{task.durationDisplay}</td>
                      <td className="px-3 py-3 align-top">
                          {loadingAi[task.formId] ? <span className="text-xs text-indigo-500 flex items-center gap-1"><Loader2 size={12} className="animate-spin"/> 分析中</span> : 
                           aiSummaries[task.formId] ? <span className="text-xs text-slate-700 whitespace-pre-wrap">{aiSummaries[task.formId]}</span> :
                           <button onClick={() => handleAnalyzeOne(task.formId)} className="text-xs border border-indigo-200 text-indigo-600 px-2 py-1 rounded bg-white hover:bg-indigo-50">分析</button>
                          }
                      </td>
                    </tr>
                  ))}
                  {paginatedDrillDownData.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-slate-400">無資料</td></tr>}
                </tbody>
              </table>
            </div>
             {drillDownData.length > 0 && (
              <div className="p-4 border-t border-slate-200 bg-slate-50 rounded-b-xl flex justify-between items-center">
                <div className="flex gap-2 items-center">
                    <span className="text-xs text-slate-500">每頁:</span>
                    <select value={itemsPerPage} onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }} className="text-xs border p-1 rounded bg-white text-slate-900">
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                    </select>
                </div>
                <div className="flex gap-2">
                    <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="p-1 border rounded bg-white disabled:opacity-50"><ChevronLeft size={16}/></button>
                    <span className="text-xs self-center"> {currentPage} / {totalPages} </span>
                    <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="p-1 border rounded bg-white disabled:opacity-50"><ChevronRight size={16}/></button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
