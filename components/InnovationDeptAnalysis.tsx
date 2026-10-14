import React, { useMemo, useState, useEffect } from 'react';
import { ProjectTask, ApprovalStatus } from '../types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, LabelList, LineChart, Line } from 'recharts';
import { analyzeInnovationDept, InnovationDeptAiResult, generatePersonSummary, generateFormSummary, generateSingleFormInstanceSummary } from '../services/geminiService';
import { BrainCircuit, Briefcase, Clock, FileCheck, CheckCircle, RefreshCw, Trophy, AlertTriangle, List, Timer, X, Download, Info, ChevronUp, ChevronDown, FileText, User, Hourglass, ChevronRight as ChevronRightIcon } from 'lucide-react';
import { MultiSelect } from './MultiSelect';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface InnovationDeptAnalysisProps {
  data: ProjectTask[];
  targetDept?: string;
}

const safeDate = (dateStr: string) => {
  if (!dateStr) return new Date();
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date() : d;
};

const getDurationSeconds = (
  task: ProjectTask & { _customDuration?: number }
) => {
  if (task._customDuration !== undefined) return task._customDuration;
  
  const startStr = task.stepStartTime || task.applyTime;
  if (!startStr) return 0;
  const start = safeDate(startStr).getTime();
  const endStr = task.stepEndTime;
  
  const end = endStr 
     ? safeDate(endStr).getTime() 
     : Date.now();
         
  return Math.max(0, (end - start) / 1000);
};

const getFormDeptDuration = (tasks: ProjectTask[]): number => {
    const intervals: {start: number, end: number}[] = tasks.map(t => {
        const start = safeDate(t.stepStartTime || t.applyTime).getTime();
        const end = t.stepEndTime ? safeDate(t.stepEndTime).getTime() : Date.now();
        return { start, end };
    }).filter(i => !isNaN(i.start) && !isNaN(i.end));

    if (intervals.length === 0) return 0;
    intervals.sort((a, b) => a.start - b.start);

    let totalDurationMs = 0;
    let currentStart = intervals[0].start;
    let currentEnd = intervals[0].end;

    for (let i = 1; i < intervals.length; i++) {
        const it = intervals[i];
        if (it.start <= currentEnd) {
            currentEnd = Math.max(currentEnd, it.end);
        } else {
            totalDurationMs += (currentEnd - currentStart);
            currentStart = it.start;
            currentEnd = it.end;
        }
    }
    totalDurationMs += (currentEnd - currentStart);
    return Math.max(0, totalDurationMs / 1000);
};

const getDisplayStatus = (task: ProjectTask, globalStatus: string) => {
  const taskText = [task.rawStepStatus, task.approvalComment, task.mainStatus].join(' ');
  if (taskText.includes('退回申請者')) {
      return ApprovalStatus.RETURNED;
  }
  if (taskText.includes('退簽') || taskText.includes('退件') || taskText.includes('退回') || taskText.includes('否決')) {
      return ApprovalStatus.REJECTED;
  }
  if (taskText.includes('作廢') || taskText.includes('撤銷') || taskText.includes('取消')) {
      return ApprovalStatus.CANCELLED;
  }
  if (taskText.includes('已由他人') || taskText.includes('由他人')) {
      return ApprovalStatus.APPROVED; // Consider 'signed by others' functionally as approved/completed to avoid being marked pending
  }

  if (task.approvalStatus !== ApprovalStatus.PENDING) return task.approvalStatus;
  
  if (globalStatus === 'APPROVED') return ApprovalStatus.APPROVED;
  if (globalStatus === 'REJECTED') return ApprovalStatus.REJECTED;
  if (globalStatus === 'CANCELLED') return ApprovalStatus.CANCELLED;

  return task.approvalStatus;
};

type FormSortType = 'AVG_DESC' | 'AVG_ASC' | 'TOTAL_DESC' | 'TOTAL_ASC';

const InnovationDeptAnalysis: React.FC<InnovationDeptAnalysisProps> = ({ data, targetDept = '創新整合部' }) => {
  const [aiAnalysis, setAiAnalysis] = useState<InnovationDeptAiResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Filters State
  const [selectedApprovers, setSelectedApprovers] = useState<string[]>([]);
  const [selectedYearMonths, setSelectedYearMonths] = useState<string[]>(() => {
      const startYM = 202512;
      const now = new Date();
      let currentYM = now.getFullYear() * 100 + now.getMonth() + 1;
      const defaultYMs = [];
      for (let y = 2025; y <= now.getFullYear(); y++) {
          for (let m = 1; m <= 12; m++) {
              const ym = y * 100 + m;
              if (ym >= startYM && ym <= currentYM) {
                  defaultYMs.push(ym.toString());
              }
          }
      }
      return defaultYMs.sort().reverse();
  });
  const [selectedFormNames, setSelectedFormNames] = useState<string[]>([]);
  const [hideZeroPending, setHideZeroPending] = useState(true);
  const [customPrompt, setCustomPrompt] = useState("");
  const [selectedForm, setSelectedForm] = useState<string | null>(null);
  const [selectedApplicantDept, setSelectedApplicantDept] = useState<string | null>(null);
  const [selectedFormStatus, setSelectedFormStatus] = useState<string[]>([]);
  const [formSort, setFormSort] = useState<FormSortType>('AVG_DESC');

  const globalFormInfo = useMemo(() => {
    const rawFormGroups: Record<string, ProjectTask[]> = {};
    data.forEach(t => {
      if (!t.formId) return;
      if (!rawFormGroups[t.formId]) rawFormGroups[t.formId] = [];
      rawFormGroups[t.formId].push(t);
    });

    const infoMap: Record<string, { status: string; formName: string; globalEndTime?: Date; stayTimeSeconds?: number; subject?: string; currentPendingPerson?: string; }> = {};
    Object.entries(rawFormGroups).forEach(([formId, logs]) => {
      const chronologicallySorted = [...logs].sort((a, b) => {
         const tA = safeDate(a.stepStartTime || a.applyTime).getTime();
         const tB = safeDate(b.stepStartTime || b.applyTime).getTime();
         return tA - tB;
      });

      let effectiveMainStatus = '';
      for (let i = chronologicallySorted.length - 1; i >= 0; i--) {
        if (chronologicallySorted[i].mainStatus) {
            effectiveMainStatus = chronologicallySorted[i].mainStatus;
            break;
        }
      }

      let validFormCategory = '一般表單';
      let validSubject = '';
      for (const log of chronologicallySorted) {
         if (log.formName && log.formName.trim() !== '') {
            validFormCategory = log.formName.trim();
         }
         if (log.subject && log.subject.trim() !== '') {
            validSubject = log.subject.trim();
         }
         if (validFormCategory !== '一般表單' && validSubject !== '') {
            break;
         }
      }

      const isMainClosed = ["結案", "核准", "完成", "不同意", "退回", "退簽", "退件", "作廢", "撤銷"].some(s => effectiveMainStatus.includes(s)) && !effectiveMainStatus.includes('中') && !effectiveMainStatus.includes('退回申請者');
      const allLogsText = logs.map(l => [l.rawStepStatus, l.approvalComment, l.mainStatus].join(' ')).join(' ');
      const hasReturned = logs.some(l => getDisplayStatus(l, '') === ApprovalStatus.RETURNED) || allLogsText.includes('退回申請者');
      const hasVeto = logs.some(l => l.approvalStatus === ApprovalStatus.REJECTED) || allLogsText.includes('退簽') || (allLogsText.includes('退回') && !allLogsText.includes('退回申請者')) || allLogsText.includes('退件') || allLogsText.includes('否決');
      const hasCancel = logs.some(l => l.approvalStatus === ApprovalStatus.CANCELLED) || allLogsText.includes('作廢') || allLogsText.includes('撤銷') || allLogsText.includes('取消');

      let finalStatus = 'PENDING';
      if (hasReturned) {
          finalStatus = 'RETURNED';
      } else if (isMainClosed) {
          if (hasCancel) finalStatus = 'CANCELLED';
          else if (hasVeto) finalStatus = 'REJECTED';
          else finalStatus = 'APPROVED';
      } else {
          let maxEndTime = 0;
          let lastEndStatus = 'PENDING';
          logs.forEach(l => {
             const eTime = l.stepEndTime ? safeDate(l.stepEndTime).getTime() : 0;
             if (eTime > maxEndTime) {
                 maxEndTime = eTime;
                 const tTxt = [l.rawStepStatus, l.approvalComment, l.mainStatus].join(' ');
                 if (tTxt.includes('退簽') || tTxt.includes('退件') || tTxt.includes('退回') || tTxt.includes('否決')) lastEndStatus = 'REJECTED';
                 else if (tTxt.includes('作廢') || tTxt.includes('撤銷') || tTxt.includes('取消')) lastEndStatus = 'CANCELLED';
                 else if (l.approvalStatus !== ApprovalStatus.PENDING) lastEndStatus = l.approvalStatus;
                 else if (tTxt.includes('已由他人') || tTxt.includes('由他人')) lastEndStatus = 'APPROVED';
                 else lastEndStatus = 'APPROVED'; 
             }
          });
          
          let hasPendingAfterLastAction = false;
          logs.forEach(l => {
              const tTxt = [l.rawStepStatus, l.approvalComment].join(' ');
              const isLogPending = l.approvalStatus === ApprovalStatus.PENDING && !tTxt.includes('已由他人') && !tTxt.includes('由他人');
              if (isLogPending) {
                  const sTime = safeDate(l.stepStartTime || l.applyTime).getTime();
                  if (maxEndTime === 0 || sTime >= maxEndTime - 60000) {
                      hasPendingAfterLastAction = true;
                  }
              }
          });

          if (hasPendingAfterLastAction) {
              finalStatus = 'PENDING';
          } else if (maxEndTime > 0) {
              finalStatus = lastEndStatus;
          } else if (hasCancel) finalStatus = 'CANCELLED';
          else if (hasVeto) finalStatus = 'REJECTED';
          else finalStatus = 'PENDING';
      }

      let endTime = new Date().getTime();
      if (finalStatus !== 'PENDING') {
         let maxTime = safeDate(chronologicallySorted[0]?.applyTime).getTime(); 
         logs.forEach(l => {
            const startT = safeDate(l.stepStartTime).getTime();
            const endT = l.stepEndTime ? safeDate(l.stepEndTime).getTime() : 0;
            if (startT > maxTime) maxTime = startT;
            if (endT > maxTime) maxTime = endT;
         });
         endTime = maxTime;
      }
      
      const applyTime = safeDate(chronologicallySorted[0]?.applyTime).getTime();
      const totalDurationSeconds = Math.floor((endTime - applyTime) / 1000);
      let stayTimeSeconds = 0;
      let currentPendingPerson = '';
      if (finalStatus === 'PENDING') {
        const activeLog = logs.find(l => !l.stepEndTime);
        const latestLog = chronologicallySorted[chronologicallySorted.length - 1];
        if (activeLog && !latestLog.stepEndTime) {
           stayTimeSeconds = Math.floor((new Date().getTime() - safeDate(activeLog.stepStartTime).getTime()) / 1000);
           currentPendingPerson = activeLog.currentApprover;
        } else {
           stayTimeSeconds = Math.floor((new Date().getTime() - safeDate(latestLog.stepStartTime).getTime()) / 1000);
           currentPendingPerson = latestLog.currentApprover;
        }
      } else if (finalStatus === 'RETURNED') {
         currentPendingPerson = logs[0]?.applicantName || '';
      } else {
         stayTimeSeconds = totalDurationSeconds;
      }
      if (stayTimeSeconds < 0) stayTimeSeconds = 0;
      
      infoMap[formId] = { status: finalStatus, formName: validFormCategory, globalEndTime: endTime, stayTimeSeconds, subject: validSubject, currentPendingPerson };
    });
    return infoMap;
  }, [data]);

  // Base Data: All tasks touched by target department
  const deptTasks = useMemo(() => {
    const excludedFormsGlobal = ['請假單', '加班單', '工作日報', '工作週報'];
    return data.filter(task => {
        if (!(task.currentApproverDept && task.currentApproverDept.includes(targetDept))) {
            return false;
        }
        const formCat = globalFormInfo[task.formId]?.formName || task.formName || '其他';
        if (excludedFormsGlobal.includes(formCat)) return false;
        return true;
    });
  }, [data, globalFormInfo, targetDept]);

  // Extract Filter Options
  const { uniqueApprovers, uniqueYearMonths, uniqueFormNames } = useMemo(() => {
     const approvers = new Set<string>();
     const yearMonths = new Set<string>();
     const formNames = new Set<string>();

     deptTasks.forEach(task => {
         if (task.currentApprover) approvers.add(task.currentApprover);
         if (task.formId && globalFormInfo[task.formId]?.formName) {
            formNames.add(globalFormInfo[task.formId].formName);
         } else if (task.formName) {
             formNames.add(task.formName);
         }
         if (task.applyTime) {
             const d = safeDate(task.applyTime);
             if (!isNaN(d.getTime())) {
                 const ym = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2, '0')}`;
                 yearMonths.add(ym);
             }
         }
     });

     return {
         uniqueApprovers: Array.from(approvers).sort(),
         uniqueYearMonths: Array.from(yearMonths).sort().reverse(),
         uniqueFormNames: Array.from(formNames).sort(),
     };
  }, [deptTasks, globalFormInfo]);

  const [drillDownYear, setDrillDownYear] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [selectedTrendDetails, setSelectedTrendDetails] = useState<{ title: string; formTasks: Record<string, ProjectTask[]> } | null>(null);
  const [selectedFocusFormId, setSelectedFocusFormId] = useState<string | null>(null);

  // Apply Filters
  const filteredDeptTasks = useMemo(() => {
     return deptTasks.filter(task => {
         const formCat = globalFormInfo[task.formId]?.formName || task.formName || '其他';
         
         const approver = task.currentApprover || '';
         
         if (selectedApprovers.length > 0 && !selectedApprovers.includes(approver)) return false;
         
         if (selectedFormNames.length > 0 && !selectedFormNames.includes(formCat)) return false;
         
         const d = safeDate(task.applyTime);
         if (!isNaN(d.getTime())) {
             const ym = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2, '0')}`;
             
             if (selectedYearMonths.length > 0) {
                 if (!selectedYearMonths.includes(ym)) return false;
             }
         } else if (selectedYearMonths.length > 0) {
             return false;
         }
         return true;
     });
  }, [deptTasks, selectedApprovers, selectedFormNames, selectedYearMonths, globalFormInfo]);

  // Calculate overall stats for the current filtered view
  const stats = useMemo(() => {
    // Collect all valid tasks that belong to Innovation Dept
    const validTasks = filteredDeptTasks.filter(task => {
        const taskText = [task.rawStepStatus, task.approvalComment, task.stepEndTime, task.durationDisplay, task.mainStatus, task.approvalStatus].join(' ');
        const isSignedByOthers = taskText.includes('已由他人') || taskText.includes('由他人');
        const isCancelledByGlobal = getDisplayStatus(task, 'PENDING') === ApprovalStatus.PENDING && !['PENDING', 'RETURNED'].includes(globalFormInfo[task.formId]?.status || 'PENDING');
        const isNotifiedOnly = taskText.includes('通知') || taskText.includes('知會') || taskText.includes('副本');
        return !isSignedByOthers && !isCancelledByGlobal && !isNotifiedOnly;
    });

    const uniqueForms = new Set(validTasks.map(t => t.formId));
    const totalProcessed = uniqueForms.size;
    const deptPendingForms = new Set(
        validTasks.filter(t => {
            const gStatus = globalFormInfo[t.formId]?.status || 'PENDING';
            return gStatus === 'PENDING' || gStatus === 'RETURNED';
        }).map(t => t.formId)
    );
    const deptPendingCount = deptPendingForms.size;

    const currentDeptPendingForms = new Set(
        validTasks.filter(t => {
            const gStatus = globalFormInfo[t.formId]?.status || 'PENDING';
            return (gStatus === 'PENDING' || gStatus === 'RETURNED') && (!t.stepEndTime || t.stepEndTime.trim() === '-' || t.stepEndTime.trim() === '');
        }).map(t => t.formId)
    );
    const currentDeptPendingCount = currentDeptPendingForms.size;

    const avgDurationSeconds = validTasks.length > 0 ? validTasks.reduce((acc, curr) => acc + getDurationSeconds(curr), 0) / validTasks.length : 0;
    const avgDurationHours = avgDurationSeconds / 3600;

    // Group by Trend Key (Year or Month)
    const trendMap: Record<string, { key: string; uniqueForms: Set<string>; totalHours: number, formTasks: Record<string, ProjectTask[]> }> = {};
    const approverMap: Record<string, { name: string; count: number; formSums: Record<string, { tasks: ProjectTask[], subject: string, formId: string, formCat: string }>, tasks: ProjectTask[] }> = {};
    const formTaskGroups: Record<string, ProjectTask[]> = {};

    validTasks.forEach(task => {
       const dateStr = task.stepEndTime || task.stepStartTime || task.applyTime;
       const date = safeDate(dateStr);
       const year = isNaN(date.getTime()) ? '未知年份' : date.getFullYear().toString();
       const month = isNaN(date.getTime()) ? '未知' : `${(date.getMonth() + 1).toString().padStart(2, '0')}月`;

       const secs = getDurationSeconds(task);
       const hours = secs / 3600;

       // Trend grouping
       const isMonthView = selectedYearMonths.length > 0 || drillDownYear;
       
       let trendKey = '';
       let shouldIncludeInTrend = true;

       if (isMonthView) {
           if (drillDownYear && selectedYearMonths.length === 0) {
               // Only include if it matches drillDownYear
               if (year !== drillDownYear && year !== '未知年份') {
                   shouldIncludeInTrend = false;
               } else {
                   trendKey = isNaN(date.getTime()) ? '未知月份' : `${(date.getMonth() + 1).toString().padStart(2, '0')}月`;
               }
           } else {
               // Month view across selected year-months
               trendKey = isNaN(date.getTime()) ? '未知月份' : `${year}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
           }
       } else {
           trendKey = year;
       }

       if (shouldIncludeInTrend) {
           if (!trendMap[trendKey]) trendMap[trendKey] = { key: trendKey, uniqueForms: new Set(), totalHours: 0, formTasks: {} };
           trendMap[trendKey].uniqueForms.add(task.formId);
           trendMap[trendKey].totalHours += hours;
           if (!trendMap[trendKey].formTasks[task.formId]) trendMap[trendKey].formTasks[task.formId] = [];
           trendMap[trendKey].formTasks[task.formId].push(task);
       }

       const formCat = globalFormInfo[task.formId]?.formName || task.formName || '其他';

       const approver = (task.currentApprover && task.currentApprover.trim() !== '' && task.currentApprover.trim() !== '-') ? task.currentApprover.trim() : '未指定';
       if (!approverMap[approver]) approverMap[approver] = { name: approver, count: 0, formSums: {}, tasks: [] };
       approverMap[approver].tasks.push(task);
       
       if (!approverMap[approver].formSums[task.formId]) {
           approverMap[approver].formSums[task.formId] = { tasks: [], subject: globalFormInfo[task.formId]?.subject || task.subject || '', formId: task.formId, formCat };
           approverMap[approver].count += 1;
       }
       if (!approverMap[approver].formSums[task.formId].subject && task.subject) {
           approverMap[approver].formSums[task.formId].subject = task.subject;
       }
       approverMap[approver].formSums[task.formId].tasks.push(task);

       if (!formTaskGroups[task.formId]) formTaskGroups[task.formId] = [];
       formTaskGroups[task.formId].push(task);
    });

    const trendData = Object.values(trendMap).sort((a, b) => a.key.localeCompare(b.key)).map(y => {
        let totalSeconds = 0;
        Object.values(y.formTasks).forEach(tasks => {
            totalSeconds += getFormDeptDuration(tasks);
        });
        const totalHoursForTrend = totalSeconds / 3600;
        return {
            key: y.key,
            count: y.uniqueForms.size,
            totalHours: totalHoursForTrend,
            avgDays: y.uniqueForms.size > 0 ? (totalHoursForTrend / 24) / y.uniqueForms.size : 0,
            formTasks: y.formTasks
        };
    });

    const approverData = Object.values(approverMap).map(a => {
        let totalSeconds = 0;
        const computedFormSums = Object.values(a.formSums).map(fs => {
            const duration = getFormDeptDuration(fs.tasks);
            totalSeconds += duration;
            return { ...fs, duration };
        });
        const totalHours = totalSeconds / 3600;
        const top3Forms = computedFormSums.sort((x, y) => y.duration - x.duration).slice(0, 3);
        return {
            ...a,
            totalHours,
            avgDays: a.count > 0 ? (totalHours / 24) / a.count : 0,
            top3Forms
        };
    }).sort((a, b) => b.totalHours - a.totalHours);

    const top10Forms = Object.values(formTaskGroups).map(tasks => {
        const first = tasks[0];
        const subjectTask = tasks.find(t => t.subject);
        return {
            duration: getFormDeptDuration(tasks),
            subject: globalFormInfo[first.formId]?.subject || subjectTask?.subject || first.formName || '無主旨',
            formId: first.formId,
            applicantName: first.applicantName,
            formCat: globalFormInfo[first.formId]?.formName || first.formName || '其他'
        };
    }).sort((a, b) => b.duration - a.duration).slice(0, 10);

    return {
        totalProcessed,
        deptPendingCount,
        currentDeptPendingCount,
        avgDurationDays: avgDurationHours / 24,
        trendData,
        approverData,
        top10Forms,
        validTasks
    };
  }, [filteredDeptTasks, drillDownYear, globalFormInfo]);

  // Aggregate into unique forms for "各表單統計與效率分析" Dashboard-like cards
  const formStats = useMemo(() => {
    // 2. Group the FILTERED Innovation Dept tasks to compute counts & avg days
    // A form might appear multiple times in the filtered list (e.g. if handles by 2 people). 
    // We group by formId first to not double count the "pending/completed" status per form.
    const formTaskGroups: Record<string, ProjectTask[]> = {};
    
    stats.validTasks.forEach(t => {
       const id = t.formId;
       if (!formTaskGroups[id]) formTaskGroups[id] = [];
       formTaskGroups[id].push(t);
    });

    const filteredFormGroups: Record<string, { durationSeconds: number, formName: string, isPending: boolean }> = {};
    
    Object.keys(formTaskGroups).forEach(id => {
        const tasks = formTaskGroups[id];
        const first = tasks[0];
        
        let isPending = false;
        tasks.forEach(t => {
           const gStatus = globalFormInfo[t.formId]?.status || 'PENDING';
           if ((gStatus === 'PENDING' || gStatus === 'RETURNED') && (!t.stepEndTime || t.stepEndTime.trim() === '-' || t.stepEndTime.trim() === '')) {
               isPending = true;
           }
        });
        
        filteredFormGroups[id] = {
            durationSeconds: getFormDeptDuration(tasks),
            formName: globalFormInfo[id]?.formName || first.formName || '其他',
            isPending
        };
    });

    // 3. Aggregate into Stats array
    const statsResult: Record<string, { pending: number, completed: number, totalDurationSeconds: number, completedCount: number, deptPendingCount: number }> = {};
    
    Object.keys(filteredFormGroups).forEach(formId => {
        const fg = filteredFormGroups[formId];
        const name = fg.formName;
        if (!statsResult[name]) statsResult[name] = { pending: 0, completed: 0, totalDurationSeconds: 0, completedCount: 0, deptPendingCount: 0 };
        
        const gStatus = globalFormInfo[formId]?.status || 'PENDING';
        
        if (gStatus === 'PENDING' || gStatus === 'RETURNED') {
            statsResult[name].pending++;
        } else {
            statsResult[name].completed++;
            statsResult[name].totalDurationSeconds += fg.durationSeconds;
            statsResult[name].completedCount++;
        }
        
        if (fg.isPending) {
             statsResult[name].deptPendingCount++;
        }
    });

    const list = Object.keys(statsResult).map(name => {
      const s = statsResult[name];
      const total = s.pending + s.completed;
      const avgDays = s.completedCount > 0 ? (s.totalDurationSeconds / s.completedCount / 86400).toFixed(2) : '0.00';
      const completionRate = total > 0 ? parseFloat(((s.completed / total) * 100).toFixed(1)) : 0;
      return { 
        name, 
        pending: s.pending, 
        completed: s.completed,
        deptPending: s.deptPendingCount,
        deptPendingCount: s.deptPendingCount,
        total, 
        pendingPct: total ? Math.round((s.pending/total)*100) : 0,
        completionRate,
        avgDays: parseFloat(avgDays)
      };
    });

    return list.sort((a, b) => {
        switch(formSort) {
            case 'AVG_DESC': return b.avgDays - a.avgDays;
            case 'AVG_ASC': return a.avgDays - b.avgDays;
            case 'TOTAL_DESC': return b.total - a.total;
            case 'TOTAL_ASC': return a.total - b.total;
            default: return b.avgDays - a.avgDays;
        }
    });
  }, [globalFormInfo, stats.validTasks, formSort]);

  // Applicant Department Stats
  const applicantDeptStats = useMemo(() => {
    const deptMap: Record<string, {
       deptName: string;
       formCounts: Record<string, number>;
       totalForms: number;
       totalDurationSeconds: number;
       completedForms: number;
       pendingForms: number;
       currentPendingFormsSet: Set<string>;
       uniqueForms: Set<string>;
    }> = {};

    stats.validTasks.forEach(task => {
        let deptName = task.applicantDept || '未知部門';
        if (deptName.includes('美學院')) {
            deptName = '全部美學院';
        } else if (deptName.includes('愛-')) {
            deptName = '全部愛漂亮';
        } else if (deptName.includes('診所')) {
            deptName = '全部診所';
        }

        if (!deptMap[deptName]) {
            deptMap[deptName] = { deptName, formCounts: {}, totalForms: 0, totalDurationSeconds: 0, completedForms: 0, pendingForms: 0, currentPendingFormsSet: new Set(), uniqueForms: new Set() };
        }
        
        const formCat = globalFormInfo[task.formId]?.formName || task.formName || '其他';
        const isNewForm = !deptMap[deptName].uniqueForms.has(task.formId);
        const gStatus = globalFormInfo[task.formId]?.status || 'PENDING';

        if (isNewForm) {
            deptMap[deptName].uniqueForms.add(task.formId);
            deptMap[deptName].totalForms++;
            deptMap[deptName].formCounts[formCat] = (deptMap[deptName].formCounts[formCat] || 0) + 1;
            
            // Check form global status
            if (gStatus === 'PENDING' || gStatus === 'RETURNED') {
                deptMap[deptName].pendingForms++;
            } else {
                deptMap[deptName].completedForms++;
            }
        }

        if ((gStatus === 'PENDING' || gStatus === 'RETURNED') && (!task.stepEndTime || task.stepEndTime.trim() === '-' || task.stepEndTime.trim() === '')) {
            deptMap[deptName].currentPendingFormsSet.add(task.formId);
        }
        
        // Sum total duration
        deptMap[deptName].totalDurationSeconds += getDurationSeconds(task);
    });

    const list = Object.values(deptMap).map(d => ({
        deptName: d.deptName,
        totalForms: d.totalForms,
        completedForms: d.completedForms,
        pendingForms: d.pendingForms,
        currentPendingForms: d.currentPendingFormsSet.size,
        avgDays: d.totalForms > 0 ? (d.totalDurationSeconds / d.totalForms / 86400).toFixed(2) : '0.00',
        formCounts: d.formCounts // Keep for detail view or tooltip if needed
    }));

    return list.sort((a, b) => b.totalForms - a.totalForms);
  }, [stats.validTasks, globalFormInfo]);

  const chartApplicantDeptStats = useMemo(() => {
     if (applicantDeptStats.length <= 10) return applicantDeptStats;
     
     const top10 = applicantDeptStats.slice(0, 10);
     const others = applicantDeptStats.slice(10);
     
     const otherAgg = others.reduce((acc, curr) => {
         acc.totalForms += curr.totalForms;
         acc.completedForms += curr.completedForms;
         acc.pendingForms += curr.pendingForms;
         return acc;
     }, {
         deptName: '其他',
         totalForms: 0,
         completedForms: 0,
         pendingForms: 0,
         avgDays: '0.00',
         formCounts: {}
     });
     
     return [...top10, otherAgg];
  }, [applicantDeptStats]);

  const [aiError, setAiError] = useState<string | null>(null);

  const runAnalysis = async () => {
    if (stats.totalProcessed === 0) return;
    setIsAnalyzing(true);
    setAiError(null);
    try {
       // Requirement for 創新整合部: 排除主管［于耀忠與陳信佑］
       const excludedApprovers = targetDept === '創新整合部' ? ['于耀忠', '陳信佑'] : [];
       const excludedForms = ['請假單', '加班單', '工作週報'];
       
       const aiTasks = stats.validTasks.filter(t => {
           const formName = globalFormInfo[t.formId]?.formName || t.formName || '';
           const approver = t.currentApprover?.trim() || '';
           if (excludedApprovers.includes(approver)) return false;
           if (excludedForms.includes(formName)) return false;
           return true;
       });

       const aiApproverMap: Record<string, { count: number, totalSecs: number }> = {};
       aiTasks.forEach(t => {
           const approver = t.currentApprover!.trim();
           if (!aiApproverMap[approver]) aiApproverMap[approver] = { count: 0, totalSecs: 0 };
           aiApproverMap[approver].count += 1;
           aiApproverMap[approver].totalSecs += getDurationSeconds(t);
       });

       const aiApproverData = Object.entries(aiApproverMap)
            .sort((a, b) => b[1].totalSecs - a[1].totalSecs)
            .map(([name, data]) => `${name}: 處理 ${data.count} 件, 平均耗時 ${(data.totalSecs / data.count / 86400).toFixed(2)} 天`);

       const summaryData = {
           整體_總處理表單數: stats.totalProcessed,
           整體_平均處理天數: stats.avgDurationDays.toFixed(2),
           整體_趨勢: stats.trendData.slice(-3).map(y => (`${y.key}: 共 ${y.count} 件, 平均耗時 ${y.avgDays.toFixed(2)} 天`)),
           同仁簽核狀況_排除主管與常規假單表單: aiApproverData,
           分析條件要求: targetDept === '創新整合部' 
                ? "請排除兩位主管［于耀忠與陳信佑］。注意：全局已優先排除[請假單、加班單、工作日報、工作週報]，請說明其他同仁的表單簽核狀況如何，分析最新篩選中其他同仁效能負擔。"
                : "注意：全局已優先排除[請假單、加班單、工作日報、工作週報]，請說明同仁的表單簽核狀況如何，分析最新篩選中同仁效能負擔。"
       };
       const result = await analyzeInnovationDept(summaryData, customPrompt, targetDept);
       setAiAnalysis(result);
    } catch (err: any) {
       console.error("AI Analysis failed", err);
       setAiError(err.message || 'AI 分析請求失敗，可能為配額不足 (429)。請稍後再試。');
    } finally {
       setIsAnalyzing(false);
    }
  };

  // Removed auto trigger for AI analysis per user request

  const [showInfoModal, setShowInfoModal] = useState(false);

  const handleExportPDF = async () => {
      const element = document.getElementById('innovation-dept-dashboard');
      if (!element) return;
      
      const originalHeight = element.style.height;
      const originalOverflow = element.style.overflow;
      
      element.style.height = 'auto';
      element.style.overflow = 'visible';
      
      const hideElms = document.querySelectorAll('.print\\:hidden');
      hideElms.forEach(e => (e as HTMLElement).style.display = 'none');
      
      await new Promise(r => setTimeout(r, 100)); // wait for DOM to update
      
      try {
          const canvas = await html2canvas(element, { scale: 2 });
          const imgData = canvas.toDataURL('image/png');
          const pdf = new jsPDF('p', 'mm', 'a4');
          const pdfWidth = pdf.internal.pageSize.getWidth();
          const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
          
          let position = 0;
          const pageHeight = pdf.internal.pageSize.getHeight();
          
          if (pdfHeight > pageHeight) {
              let heightLeft = pdfHeight;
              pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
              heightLeft -= pageHeight;
              
              while (heightLeft >= 0) {
                  position = heightLeft - pdfHeight;
                  pdf.addPage();
                  pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
                  heightLeft -= pageHeight;
              }
          } else {
              pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
          }
          
          pdf.save(`${targetDept}分析.pdf`);
      } finally {
          element.style.height = originalHeight;
          element.style.overflow = originalOverflow;
          hideElms.forEach(e => (e as HTMLElement).style.display = '');
      }
  };

  if (deptTasks.length === 0) {
    return <div className="p-8 text-center text-slate-500">在此資料集中，找不到「{targetDept}」處理過的地表單紀錄。</div>;
  }

  return (
    <div id="innovation-dept-dashboard" className="p-6 space-y-6 max-w-7xl mx-auto min-h-screen print:h-auto print:max-w-none print:p-0 print:overflow-visible bg-slate-50/30">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
            <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                <Briefcase className="text-[#5D4037]" />
                {targetDept}成效與稽核專區
                <button onClick={() => setShowInfoModal(true)} className="ml-2 text-slate-400 hover:text-[#5D4037] transition-colors print:hidden" title="查看頁面邏輯說明">
                    <Info size={20} />
                </button>
            </h2>
            <p className="text-sm text-slate-500 mt-1">
                專屬儀表板，追蹤該部門的工作處理量、效率變化與管理重點。
            </p>
        </div>
        <div className="flex flex-col gap-2 print:hidden w-full md:w-auto">
            <input 
                 type="text"
                 placeholder="（選填）向 AI 提示想要分析的重點，例如：請檢查某某流程是否耗時過長..."
                 value={customPrompt}
                 onChange={(e) => setCustomPrompt(e.target.value)}
                 className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#5D4037]/50"
            />
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <button 
                   onClick={handleExportPDF}
                   className="flex justify-center items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm whitespace-nowrap"
                >
                   <Download size={16} />
                   匯出 PDF
                </button>
                <button 
                   onClick={runAnalysis}
                   disabled={isAnalyzing || stats.totalProcessed === 0}
                   className="flex-1 justify-center items-center flex gap-2 bg-[#5D4037] hover:bg-[#4E342E] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-70 whitespace-nowrap"
                >
                   {isAnalyzing ? <RefreshCw className="animate-spin" size={16} /> : <BrainCircuit size={16} />}
                   {isAnalyzing ? '分析中...' : '生成 AI 建議'}
                </button>
            </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap gap-4 items-center print:hidden">
         <div className="w-48">
             <MultiSelect 
                 options={uniqueApprovers}
                 selected={selectedApprovers}
                 onChange={setSelectedApprovers}
                 label="人員"
                 placeholder="全部人員"
             />
         </div>
         <div className="w-32">
             <MultiSelect 
                 options={uniqueYearMonths}
                 selected={selectedYearMonths}
                 onChange={setSelectedYearMonths}
                 label="申請年月"
                 placeholder="全部"
             />
         </div>
         <div className="w-56">
             <MultiSelect 
                 options={uniqueFormNames}
                 selected={selectedFormNames}
                 onChange={setSelectedFormNames}
                 label="表單名稱"
                 placeholder="全部表單"
             />
         </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-lg"><FileCheck size={24} /></div>
            <div>
                <p className="text-sm font-medium text-slate-500">篩選後總累計處理件數</p>
                <p className="text-2xl font-bold text-slate-800">{stats.totalProcessed.toLocaleString()} 件</p>
            </div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="p-3 bg-purple-50 text-purple-600 rounded-lg"><Clock size={24} /></div>
            <div>
                <p className="text-sm font-medium text-slate-500">篩選後平均處理單件耗時</p>
                <p className="text-2xl font-bold text-slate-800">{stats.avgDurationDays.toFixed(2)} <span className="text-base font-medium text-slate-500">天</span></p>
            </div>
        </div>
        <div onClick={() => { setSelectedForm('進行中案件明細'); setSelectedFormStatus([ApprovalStatus.PENDING, ApprovalStatus.RETURNED]); }} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4 cursor-pointer hover:bg-slate-50 transition-colors">
            <div className="p-3 bg-amber-50 text-amber-600 rounded-lg"><Hourglass size={24} /></div>
            <div>
                <div className="flex items-center gap-1 mb-0.5">
                   <p className="text-sm font-medium text-slate-500">部內參與_未結案</p>
                   <ChevronRightIcon size={14} className="text-slate-400" />
                </div>
                <p className="text-2xl font-bold text-slate-800">{stats.deptPendingCount.toLocaleString()} 件</p>
            </div>
        </div>
        <div onClick={() => { setSelectedForm('部內目前待簽核明細'); setSelectedFormStatus([ApprovalStatus.PENDING, ApprovalStatus.RETURNED]); }} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4 cursor-pointer hover:bg-slate-50 transition-colors">
            <div className="p-3 bg-orange-50 text-orange-600 rounded-lg"><Hourglass size={24} /></div>
            <div>
                <div className="flex items-center gap-1 mb-0.5">
                   <p className="text-sm font-medium text-slate-500">部內目前待簽核</p>
                   <ChevronRightIcon size={14} className="text-slate-400" />
                </div>
                <p className="text-2xl font-bold text-slate-800">{stats.currentDeptPendingCount.toLocaleString()} 件</p>
            </div>
        </div>
      </div>

      {aiError && !isAnalyzing && (
        <div className="bg-red-50 p-6 rounded-xl border border-red-200 shadow-sm flex items-start gap-3">
            <AlertTriangle className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
            <div>
               <h3 className="text-red-800 font-bold mb-1">AI 分析失敗</h3>
               <p className="text-red-600 text-sm whitespace-pre-wrap">{aiError}</p>
            </div>
        </div>
      )}

      {aiAnalysis && stats.totalProcessed > 0 && (
        <div className="bg-gradient-to-br from-indigo-50 via-white to-purple-50 p-6 rounded-xl border border-indigo-100 shadow-sm space-y-6">
            <div className="flex items-center gap-3 border-b border-indigo-100 pb-4">
                <BrainCircuit className="text-indigo-600" size={24} />
                <h3 className="text-lg font-bold text-indigo-900">AI 主管決策支援（基於最新篩選結果）</h3>
            </div>
            
            <div className="space-y-5">
                <div>
                   <h4 className="flex items-center gap-2 text-sm font-bold text-indigo-800 mb-2">
                       <CheckCircle size={16} /> 整體效能總結
                   </h4>
                   <p className="text-slate-700 bg-white p-4 rounded-lg border border-indigo-50 shadow-sm leading-relaxed">
                       {aiAnalysis.performanceSummary}
                   </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <h4 className="flex items-center gap-2 text-sm font-bold text-amber-600 mb-3">
                            <AlertTriangle size={16} /> 管理注意要點
                        </h4>
                        <div className="space-y-3">
                            {aiAnalysis.managerAdvice.map((advice, idx) => (
                                <div key={idx} className="bg-white p-3 rounded-lg border border-amber-100 shadow-sm text-sm text-slate-700 flex gap-3 items-start">
                                    <span className="bg-amber-100 text-amber-700 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold">{idx + 1}</span>
                                    <div className="pt-0.5">{advice}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div>
                        <h4 className="flex items-center gap-2 text-sm font-bold text-emerald-600 mb-3">
                            <Trophy size={16} /> 爭取 KPI 論述策略
                        </h4>
                        <div className="space-y-3">
                            {aiAnalysis.kpiArguments.map((arg, idx) => (
                                <div key={idx} className="bg-white p-3 rounded-lg border border-emerald-100 shadow-sm text-sm text-slate-700 flex gap-3 items-start">
                                    <span className="bg-emerald-100 text-emerald-700 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold">{idx + 1}</span>
                                    <div className="pt-0.5">{arg}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-12">
         <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm relative print:break-inside-avoid">
             {drillDownYear && selectedYearMonths.length === 0 && (
                 <button onClick={() => setDrillDownYear(null)} className="absolute top-4 right-4 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-md font-medium transition-colors">
                     返回年度視圖
                 </button>
             )}
             <h3 className="text-base font-bold text-slate-800 mb-4">{drillDownYear || selectedYearMonths.length > 0 ? '每月處理量與效率趨勢' : '年度處理量與效率趨勢'}</h3>
             <div className="h-72 w-full">
                 <ResponsiveContainer width="100%" height="100%">
                     <BarChart data={stats.trendData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }} onClick={(state) => { 
                         if (state?.activeLabel) {
                             const isMonthView = selectedYearMonths.length > 0 || drillDownYear;
                             if (!isMonthView) {
                                 setDrillDownYear(state.activeLabel);
                             } else {
                                 setSelectedTrendDetails({ 
                                     title: `${state.activeLabel}`, 
                                     formTasks: stats.trendData.find(d => d.key === state.activeLabel)?.formTasks || {} 
                                 });
                             }
                         }
                     }}>
                         <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                         <XAxis dataKey="key" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                         <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                         <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                         <RechartsTooltip 
                             contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                             formatter={(value: any, name: string) => {
                                 if (name === '平均耗時(天)') return [Number(value).toFixed(2), name];
                                 return [value, name];
                             }}
                         />
                         <Legend wrapperStyle={{ paddingTop: '20px' }} />
                         <Bar yAxisId="left" dataKey="count" name="處理件數" fill="#818cf8" radius={[4, 4, 0, 0]} style={{cursor: 'pointer'}}>
                             <LabelList dataKey="count" position="center" fill="#ffffff" fontSize={11} fontWeight={600} formatter={(v) => v > 0 ? v : ""}/>
                         </Bar>
                         <Line yAxisId="right" type="monotone" dataKey="avgDays" name="平均耗時(天)" stroke="#f59e0b" strokeWidth={2} dot={{r: 4}}>
                             <LabelList dataKey="avgDays" position="top" fill="#d97706" fontSize={11} fontWeight={600} formatter={(val: number) => val.toFixed(2)} />
                         </Line>
                     </BarChart>
                 </ResponsiveContainer>
             </div>
         </div>

         <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col print:break-inside-avoid">
             <div className="flex justify-between items-center mb-4 flex-shrink-0">
                 <h3 className="text-base font-bold text-slate-800">部門人員貢獻度 (全體)</h3>
             </div>
             <div className="flex-1 w-full pr-2">
                 <ResponsiveContainer width="100%" height={Math.max(300, stats.approverData.length * 40)}>
                     <BarChart data={stats.approverData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }} onClick={(state) => { if (state?.activeLabel) setSelectedPerson(state.activeLabel); }}>
                         <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                         <XAxis type="number" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                         <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{fill: '#475569', fontSize: 12, fontWeight: 500}} width={100} style={{cursor: 'pointer'}} />
                         <RechartsTooltip 
                             cursor={{fill: '#f8fafc'}}
                             contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                         />
                         <Legend wrapperStyle={{ paddingTop: '20px' }} />
                         <Bar dataKey="count" name="處理件數" fill="#34d399" radius={[0, 4, 4, 0]} barSize={20} style={{cursor: 'pointer'}}>
                             <LabelList dataKey="count" position="right" fill="#64748b" fontSize={12} />
                         </Bar>
                     </BarChart>
                 </ResponsiveContainer>
             </div>
         </div>
      </div>

      {/* Top Consuming Forms Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col print:break-inside-avoid">
             <div className="flex justify-between items-center mb-4 flex-shrink-0">
                 <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                    <Clock className="text-red-500" size={18} />
                    {targetDept}最耗時表單 TOP 10
                 </h3>
             </div>
             <div className="flex-1 w-full pr-2">
                <div className="space-y-3">
                    {stats.top10Forms.length === 0 ? (
                        <div className="text-sm text-slate-400 text-center py-8">無資料</div>
                    ) : stats.top10Forms.map((f, idx) => (
                        <div key={f.formId} onClick={() => setSelectedFocusFormId(f.formId)} className="flex flex-col p-3 rounded-lg bg-slate-50 border border-slate-100 transition-colors hover:bg-slate-200 cursor-pointer">
                           <div className="flex items-center gap-2 mb-1">
                               <div className="flex items-center justify-center w-5 h-5 rounded-full bg-red-100 text-red-700 text-xs font-bold leading-none flex-shrink-0">{idx + 1}</div>
                               <span className="font-semibold text-slate-700 text-sm line-clamp-1 flex-1" title={f.formId}>{f.formId}</span>
                               <span className="text-xs font-mono text-red-600 bg-red-50 px-2 py-0.5 rounded font-medium border border-red-100 flex-shrink-0">
                                   {(f.duration / 86400).toFixed(2)} 天
                               </span>
                           </div>
                           <div className="flex justify-between items-center text-[11px] text-slate-500 ml-7">
                               <div className="flex items-center gap-2">
                                  <span className="bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded border border-indigo-100">{f.formCat}</span>
                               </div>
                               <span>{f.applicantName || '未知'}</span>
                           </div>
                        </div>
                    ))}
                </div>
             </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col print:break-inside-avoid">
             <div className="flex justify-between items-center mb-4 flex-shrink-0">
                 <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                    <User className="text-indigo-500" size={18} />
                    每個人耗時最多的表單 TOP 3
                 </h3>
             </div>
             <div className="flex-1 w-full pr-2 space-y-4">
                 {stats.approverData.filter(a => a.top3Forms.length > 0).length === 0 ? (
                      <div className="text-sm text-slate-400 text-center py-8">無資料</div>
                 ) : stats.approverData.filter(a => a.top3Forms.length > 0).map(a => (
                     <div key={a.name} className="border border-slate-100 rounded-lg overflow-hidden print:break-inside-avoid">
                        <div className="bg-slate-50 px-3 py-2 border-b border-slate-100 flex justify-between items-center">
                           <span className="font-bold text-slate-700 text-sm">{a.name}</span>
                        </div>
                        <div className="p-2 space-y-2 bg-white">
                            {a.top3Forms.map((f, idx) => (
                                <div key={f.formId} onClick={() => setSelectedFocusFormId(f.formId)} className="flex flex-col gap-1 text-sm justify-between p-2 rounded hover:bg-slate-50 transition-colors cursor-pointer border border-transparent hover:border-slate-100">
                                   <div className="flex items-center gap-2 overflow-hidden w-full">
                                       <span className="text-slate-400 text-xs w-3 flex-shrink-0">{idx + 1}.</span>
                                       <span className="text-slate-700 font-medium truncate text-xs flex-1" title={f.formId}>{f.formId}</span>
                                       <span className="text-xs font-mono text-slate-500 whitespace-nowrap bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100 flex-shrink-0">
                                           {(f.duration / 86400).toFixed(2)} 天
                                       </span>
                                   </div>
                                   <div className="flex items-center gap-2 pl-5">
                                        <span className="bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded border border-indigo-100 text-[10px]">{f.formCat}</span>
                                   </div>
                                </div>
                            ))}
                        </div>
                     </div>
                 ))}
             </div>
          </div>
      </div>

      {/* 各表單統計與效率分析 (Dashboard Style) */}
      <div className="flex flex-col gap-4">
         <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex-wrap gap-3">
           <div className="flex items-center gap-2">
             <div className="p-2 bg-blue-50 rounded-lg text-blue-600"><List size={20} /></div>
             <h3 className="font-bold text-slate-800">各表單統計與效率分析</h3>
             {formStats.length > 0 && (
                 <span className="text-sm px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full font-bold ml-2">
                     總結案率 {(() => {
                         const totalCompleted = formStats.reduce((sum, item) => sum + item.completed, 0);
                         const totalForms = formStats.reduce((sum, item) => sum + item.total, 0);
                         return totalForms > 0 ? ((totalCompleted / totalForms) * 100).toFixed(1) : 0;
                     })()}%
                 </span>
             )}
           </div>
           
           <div className="flex items-center gap-3 flex-wrap">
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
         
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pr-2 print:max-h-none print:overflow-visible">
           {formStats.filter(f => !hideZeroPending || f.pending > 0).map(form => (
              <div key={form.name} onClick={() => { setSelectedForm(form.name); setSelectedFormStatus([]); }} className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-all group relative overflow-hidden cursor-pointer print:break-inside-avoid">
                 <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500 opacity-80 group-hover:bg-indigo-600"></div>
                 <div className="flex justify-between items-start mb-3 pl-2">
                    <h4 className="font-bold text-base text-slate-800 line-clamp-2" title={form.name}>{form.name}</h4>
                    <div className="flex-shrink-0 flex items-center gap-1 bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-xs font-bold border border-indigo-100">
                       <Timer size={12} /> {form.avgDays}天
                    </div>
                 </div>
                 {form.deptPending > 0 && (
                     <div className="mb-2 pl-2 inline-block">
                         <span className="bg-red-50 text-red-600 border border-red-200 text-[10px] px-1.5 py-0.5 rounded font-bold animate-pulse">
                             {targetDept}待簽核
                         </span>
                     </div>
                 )}
                 <div className="pl-2 mb-3">
                    <div className="flex justify-between items-center text-xs text-slate-500 mb-1">
                        <span>總案件: <span className="font-semibold text-slate-700">{form.total.toLocaleString()}</span></span>
                        {form.pending === 0 ? (
                            <span className="font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">100% 結案</span>
                        ) : (
                            <span className="font-bold text-slate-600 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                                結案率 {form.completionRate}%
                            </span>
                        )}
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1.5 flex">
                        <div style={{ width: `${form.pendingPct}%` }} className="bg-amber-400 h-full" />
                        <div style={{ width: `${100 - form.pendingPct}%` }} className="bg-emerald-500 h-full" />
                    </div>
                 </div>
                 <div className="flex gap-2 pl-2">
                    <div onClick={(e) => { e.stopPropagation(); setSelectedForm(form.name); setSelectedFormStatus([ApprovalStatus.PENDING, ApprovalStatus.RETURNED]); }} className="flex-1 py-1.5 rounded bg-amber-50 border border-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center gap-1 hover:bg-amber-100 transition-colors cursor-pointer">
                       <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div> 進行中 {form.pending}
                    </div>
                    <div onClick={(e) => { e.stopPropagation(); setSelectedForm(form.name); setSelectedFormStatus([ApprovalStatus.APPROVED, ApprovalStatus.REJECTED, ApprovalStatus.CANCELLED]); }} className="flex-1 py-1.5 rounded bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-bold flex items-center justify-center gap-1 hover:bg-emerald-100 transition-colors cursor-pointer">
                       <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> 已結案 {form.completed}
                    </div>
                 </div>
              </div>
            ))}
         </div>
      </div>

      {/* 創新部簽核單源頭分佈 (Applicant Dept) */}
      <div className="flex flex-col gap-4 mb-6">
         <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex-wrap gap-3">
           <div className="flex items-center gap-2">
             <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600"><Briefcase size={20} /></div>
             <h3 className="font-bold text-slate-800">{targetDept}簽核單源頭分佈 (申請部門)</h3>
           </div>
         </div>

         {/* Chart Section */}
         {chartApplicantDeptStats.length > 0 && (
             <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm print:break-inside-avoid">
                 <div style={{ height: Math.max(350, chartApplicantDeptStats.length * 40) }} className="w-full">
                     <ResponsiveContainer width="100%" height="100%">
                         <BarChart data={chartApplicantDeptStats} margin={{ top: 20, right: 30, left: 0, bottom: 20 }} layout="vertical" onClick={(state) => { if (state?.activeLabel && state.activeLabel !== '其他') setSelectedApplicantDept(state.activeLabel); }}>
                             <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={true} vertical={false} />
                             <XAxis type="number" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                             <YAxis type="category" dataKey="deptName" width={220} tick={{ fontSize: 12, fill: '#334155', fontWeight: 600, cursor: 'pointer' }} axisLine={false} tickLine={false} interval={0} />
                             <RechartsTooltip 
                                 cursor={{ fill: '#f8fafc' }}
                                 contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                             />
                             <Legend wrapperStyle={{ fontSize: '12px' }}/>
                             <Bar dataKey="completedForms" name="結案數量" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} barSize={24} />
                             <Bar dataKey="pendingForms" name="未結案數量" stackId="a" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={24}>
                                 <LabelList dataKey="totalForms" position="right" style={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} />
                             </Bar>
                         </BarChart>
                     </ResponsiveContainer>
                 </div>
             </div>
         )}

         <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto print:overflow-visible print:break-inside-avoid">
             <table className="w-full text-left text-sm whitespace-nowrap min-w-[700px] print:min-w-0">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 text-xs text-slate-500">
                   <tr>
                       <th className="px-4 py-3 font-semibold">申請部門</th>
                       <th className="px-4 py-3 font-semibold text-right">處理數量 (件)</th>
                       <th className="px-4 py-3 font-semibold text-right">結案數量</th>
                       <th className="px-4 py-3 font-semibold text-right">部內參與_未結案</th>
                       <th className="px-4 py-3 font-semibold text-right text-orange-600">部內目前待簽核</th>
                       <th className="px-4 py-3 font-semibold text-right">部內均耗時</th>
                       <th className="px-4 py-3 font-semibold">主要表單類型</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {applicantDeptStats.map((dept, idx) => {
                        const topForms = Object.entries(dept.formCounts).sort((a,b) => b[1] - a[1]).slice(0, 2);
                        return (
                            <tr key={idx} onClick={() => setSelectedApplicantDept(dept.deptName)} className="hover:bg-slate-50 transition-colors cursor-pointer group print:break-inside-avoid">
                                <td className="px-4 py-3 font-medium text-indigo-600 group-hover:text-indigo-800 transition-colors">{dept.deptName}</td>
                                <td className="px-4 py-3 text-right font-medium">{dept.totalForms.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right text-emerald-600 font-medium">{dept.completedForms.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right text-amber-600 font-medium">{dept.pendingForms.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right text-orange-600 font-bold">{dept.currentPendingForms.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right font-mono text-indigo-600 font-medium">{dept.avgDays} 天</td>
                                <td className="px-4 py-3">
                                    <div className="flex gap-2">
                                       {topForms.map(([fName, count]) => (
                                           <span key={fName} className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs border border-slate-200">
                                              {fName} ({count})
                                           </span>
                                       ))}
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                    {applicantDeptStats.length === 0 && (
                        <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">目前無來源資料</td></tr>
                    )}
                </tbody>
             </table>
         </div>
      </div>

      {/* 創整部接最多的表單 TOP 10 */}
      <div className="flex flex-col gap-4 mb-6">
         <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex-wrap gap-3">
           <div className="flex items-center gap-2">
             <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600"><Trophy size={20} /></div>
             <h3 className="font-bold text-slate-800">{targetDept}接最多表單類型 TOP 10</h3>
           </div>
         </div>

         <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto print:overflow-visible print:break-inside-avoid">
             <table className="w-full text-left text-sm whitespace-nowrap min-w-[700px] print:min-w-0">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 text-xs text-slate-500">
                   <tr>
                       <th className="px-4 py-3 font-semibold w-16 text-center">排名</th>
                       <th className="px-4 py-3 font-semibold">表單名稱</th>
                       <th className="px-4 py-3 font-semibold text-right">處理數量 (件)</th>
                       <th className="px-4 py-3 font-semibold text-right">結案數量</th>
                       <th className="px-4 py-3 font-semibold text-right">部內參與_未結案</th>
                       <th className="px-4 py-3 font-semibold text-right text-orange-600">部內目前待簽核</th>
                       <th className="px-4 py-3 font-semibold text-right">部內均耗時</th>
                       <th className="px-4 py-3 font-semibold text-center">結案率</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {[...formStats].sort((a,b) => b.total - a.total).slice(0, 10).map((form, idx) => (
                        <tr key={idx} onClick={() => { setSelectedForm(form.name); setSelectedFormStatus([]); }} className="hover:bg-slate-50 transition-colors cursor-pointer group print:break-inside-avoid">
                            <td className="px-4 py-3 font-medium text-slate-400 text-center">
                                {idx < 3 ? (
                                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-xs font-bold ${idx === 0 ? 'bg-amber-400' : idx === 1 ? 'bg-slate-300' : 'bg-amber-600'}`}>
                                        {idx + 1}
                                    </span>
                                ) : (
                                    <span>{idx + 1}</span>
                                )}
                            </td>
                            <td className="px-4 py-3 font-bold text-indigo-600 group-hover:text-indigo-800 transition-colors">{form.name}</td>
                            <td className="px-4 py-3 text-right font-bold text-slate-800">{form.total.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right text-emerald-600 font-medium">{form.completed.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right text-amber-600 font-medium">{form.pending.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right text-orange-600 font-bold">{form.deptPendingCount.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right font-mono text-indigo-600 font-medium">{form.avgDays} 天</td>
                            <td className="px-4 py-3 text-center text-slate-600 font-medium">{form.completionRate}%</td>
                        </tr>
                    ))}
                    {formStats.length === 0 && (
                        <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">目前無資料</td></tr>
                    )}
                </tbody>
             </table>
         </div>
      </div>

      {/* Deleted space */}

      {selectedPerson && (
        <GenericDetailModal 
            title={`人員詳細表單明細: ${selectedPerson}`}
            tasks={stats.approverData.find(a => a.name === selectedPerson)?.tasks || []} 
            globalFormInfo={globalFormInfo}
            onClose={() => setSelectedPerson(null)} 
            onAnalyze={() => generatePersonSummary(selectedPerson, stats.approverData.find(a => a.name === selectedPerson)?.tasks || [])}
            analyzeLabel="摘要分析"
            aiTitle="AI 績效摘要"
        />
      )}

      {selectedApplicantDept && (
        <GenericDetailModal 
            title={`申請部門明細: ${selectedApplicantDept}`}
            tasks={stats.validTasks.filter(t => {
                 let dName = t.applicantDept || '未知部門';
                 if (dName.includes('美學院')) dName = '全部美學院';
                 else if (dName.includes('愛-')) dName = '全部愛漂亮';
                 else if (dName.includes('診所')) dName = '全部診所';
                 return dName === selectedApplicantDept;
            })} 
            globalFormInfo={globalFormInfo}
            onClose={() => setSelectedApplicantDept(null)} 
            onAnalyze={undefined}
            initialStatusFilter={[]}
        />
      )}

      {selectedForm && (
        <GenericDetailModal 
            title={['進行中案件明細', '申請案件趨勢明細', '部內目前待簽核明細'].includes(selectedForm) ? selectedForm : `表單詳細明細: ${selectedForm}`}
            tasks={
                selectedForm === '進行中案件明細' || selectedForm === '申請案件趨勢明細' ? stats.validTasks :
                selectedForm === '部內目前待簽核明細' ? stats.validTasks.filter(t => !t.stepEndTime || t.stepEndTime.trim() === '-' || t.stepEndTime.trim() === '') :
                stats.validTasks.filter(t => (globalFormInfo[t.formId]?.formName || t.formName || '其他') === selectedForm)
            } 
            globalFormInfo={globalFormInfo}
            onClose={() => { setSelectedForm(null); setSelectedFormStatus([]); }} 
            onAnalyze={() => generateFormSummary(selectedForm, 
                selectedForm === '進行中案件明細' || selectedForm === '申請案件趨勢明細' ? stats.validTasks :
                selectedForm === '部內目前待簽核明細' ? stats.validTasks.filter(t => !t.stepEndTime || t.stepEndTime.trim() === '-' || t.stepEndTime.trim() === '') :
                stats.validTasks.filter(t => (globalFormInfo[t.formId]?.formName || t.formName || '其他') === selectedForm)
            )}
            analyzeLabel="流程分析"
            aiTitle="AI 改善建議"
            initialStatusFilter={selectedFormStatus}
            deduplicateDetails={true}
        />
      )}

      {selectedTrendDetails && (
        <TrendDetailModal 
            title={`期間明細: ${selectedTrendDetails.title}`} 
            formTasks={selectedTrendDetails.formTasks}
            globalFormInfo={globalFormInfo} 
            targetDept={targetDept}
            onClose={() => setSelectedTrendDetails(null)} 
        />
      )}

      {selectedFocusFormId && (
        <GenericDetailModal 
            title={`單筆表單明細: ${globalFormInfo[selectedFocusFormId]?.formName || '其他'} (${selectedFocusFormId})`}
            tasks={data.filter(t => t.formId === selectedFocusFormId)} 
            globalFormInfo={globalFormInfo}
            onClose={() => setSelectedFocusFormId(null)} 
            onAnalyze={() => generateSingleFormInstanceSummary(selectedFocusFormId, data.filter(t => t.formId === selectedFocusFormId))}
            analyzeLabel="個案AI分析"
            aiTitle="AI 單筆表單洞察"
            highlightDept={targetDept}
        />
      )}

      {showInfoModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
                <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50/50">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Info size={20} className="text-indigo-600" /> 畫面邏輯說明</h3>
                    <button onClick={() => setShowInfoModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-5 overflow-y-auto space-y-4 text-sm text-slate-600 leading-relaxed custom-scrollbar">
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                        <h4 className="font-bold text-slate-800 mb-1">1. 資料範圍與預設</h4>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>預設篩選當前系統年份 (如 2026 年)，可以手動取消以查看全部。</li>
                            <li>時間若未選擇年份，則月與日篩選條件會自動停用並失效。</li>
                            <li>「人員狀態」判斷依據為 EIP 系統帳號狀態，停用者即判定為離職。</li>
                        </ul>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                        <h4 className="font-bold text-slate-800 mb-1">2. 處理耗時與狀態判定規則</h4>
                        <ul className="list-disc pl-5 space-y-1">
                            <li><span className="font-medium text-slate-700">結束時間：</span>依照{targetDept}各簽核人實際簽核的時間計算。若處於未簽核狀態，則隨時間遞增（計算至目前系統時間）。</li>
                            <li><span className="font-medium text-slate-700">過濾無效任務：</span>若該人員於該關卡僅為「通知/知會/副本」，或狀態為「已由他人簽核」(如並簽時被其他人核准)，皆【不會】納入個人或部門的處理件數與耗時計算中。</li>
                            <li><span className="font-medium text-slate-700">表單狀態判定：</span>會綜合判斷全表單的進行狀態。若狀態包含「結案、核准、完成、不同意、退回、退簽、退件、作廢、撤銷、取消」等字眼，將不再視為「進行中/未簽核」。</li>
                            <li><span className="font-medium text-slate-700">各表單統計與效率分析：</span>僅計算該表單中實際有簽核的部內人員數據，且只有在表單還有「未簽核」且未被全域結案(退回/作廢等)的狀況下，才會列為進行中。</li>
                            <li><span className="font-medium text-slate-700">部門人員貢獻度：</span>僅計算該人員個人實際負責的簽核時間與件數任務。</li>
                        </ul>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                        <h4 className="font-bold text-slate-800 mb-1">3. 圖表與互動</h4>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>在「年度處理量與效率趨勢」中點擊長條圖，可向下切換至以「月」為單位的檢視，再次點選可查看期間單據明細。</li>
                            <li>「人員貢獻度圖表」可隱藏離職/停用人員，聚焦當前團隊效能。</li>
                            <li>可點擊人員姓名查看該人員處理的詳細落點。</li>
                        </ul>
                    </div>
                </div>
                <div className="p-4 border-t border-slate-100 flex justify-end">
                    <button onClick={() => setShowInfoModal(false)} className="px-4 py-2 bg-indigo-50 text-indigo-700 font-medium rounded-lg hover:bg-indigo-100 transition-colors">
                        了解
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}

const ExpandableComments: React.FC<{ comments: string[] }> = ({ comments }) => {
    const [expanded, setExpanded] = useState(false);
    if (!comments || comments.length === 0) return <span className="text-slate-300">-</span>;
    if (comments.length === 1) return <span className="line-clamp-3" title={comments[0]}>{comments[0]}</span>;
    return (
        <div className="flex flex-col items-start gap-1">
            {expanded ? (
                <div className="space-y-1">
                    {comments.map((c, i) => (
                        <div key={i} className="text-xs pb-1 border-b border-slate-100 last:border-0">{c}</div>
                    ))}
                </div>
            ) : (
                <span className="line-clamp-2">{comments[0]} <span className="text-slate-400">...</span></span>
            )}
            <button 
                onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }} 
                className="text-[10px] text-indigo-500 hover:text-indigo-700 font-medium flex items-center mt-0.5"
            >
                {expanded ? '縮小顯示' : `展開顯示所有意見 (${comments.length})`}
            </button>
        </div>
    );
};

const GenericDetailModal: React.FC<{ 
    title: string; 
    tasks: ProjectTask[]; 
    globalFormInfo: Record<string, { status: string; formName: string }>; 
    onClose: () => void;
    onAnalyze?: () => Promise<string | null>;
    analyzeLabel?: string;
    aiTitle?: string;
    initialStatusFilter?: string[];
    deduplicateDetails?: boolean;
    rawTasksForAi?: ProjectTask[];
    highlightDept?: string;
}> = ({ title, tasks, globalFormInfo, onClose, onAnalyze, analyzeLabel = 'AI 流程分析', aiTitle = 'AI 改善建議', initialStatusFilter = [], deduplicateDetails = false, rawTasksForAi, highlightDept }) => {
    const [aiSummary, setAiSummary] = useState<string | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analyzingFormId, setAnalyzingFormId] = useState<string | null>(null);
    const [formSummaries, setFormSummaries] = useState<Record<string, string>>({});
    
    const [statusFilter, setStatusFilter] = useState<string[]>(initialStatusFilter);
    const [formIdFilter, setFormIdFilter] = useState("");
    const [approverFilter, setApproverFilter] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(20);
    const [sortConfig, setSortConfig] = useState<{key: 'formId' | 'status' | 'duration', direction: 'asc'|'desc'}>({ key: 'duration', direction: 'desc' });

    const handleAnalyze = async () => {
        if (!onAnalyze) return;
        setIsAnalyzing(true);
        try {
            const result = await onAnalyze();
            setAiSummary(result);
        } catch(e) {
            console.error(e);
        } finally {
            setIsAnalyzing(false);
        }
    }

    const handleSingleAnalyze = async (formId: string) => {
        setAnalyzingFormId(formId);
        try {
            const instanceTasks = (rawTasksForAi || tasks).filter(t => t.formId === formId);
            const result = await generateSingleFormInstanceSummary(formId, instanceTasks);
            setFormSummaries(prev => ({...prev, [formId]: result}));
        } catch (e) {
            console.error(e);
        } finally {
            setAnalyzingFormId(null);
        }
    }

    const filteredTasks = useMemo(() => {
        let list = tasks as Array<ProjectTask & { _customDuration?: number }>;
        
        if (deduplicateDetails) {
            const map: Record<string, ProjectTask & { _customDuration: number, _approverSet: Set<string>, _comments: string[], _dedupDisplayStatus?: string }> = {};
            list.forEach(t => {
                const currentStatus = getDisplayStatus(t, globalFormInfo[t.formId]?.status || 'PENDING');
                const tTxt = [t.rawStepStatus, t.approvalComment].join(' ');
                const isBypassed = tTxt.includes('已由他人') || tTxt.includes('由他人');

                if (!map[t.formId]) {
                    map[t.formId] = { 
                        ...t, 
                        _customDuration: getDurationSeconds(t, globalFormInfo), 
                        _approverSet: new Set(t.currentApprover && !isBypassed ? [t.currentApprover] : []),
                        _comments: t.approvalComment ? [t.approvalComment] : [],
                        _dedupDisplayStatus: currentStatus
                    };
                } else {
                    map[t.formId]._customDuration += getDurationSeconds(t, globalFormInfo);
                    if (t.currentApprover && !isBypassed) map[t.formId]._approverSet.add(t.currentApprover);
                    if (t.approvalComment) map[t.formId]._comments.push(t.approvalComment);
                    if (!map[t.formId].subject && t.subject) map[t.formId].subject = t.subject;
                    // If any task is pending or returned, the deduplicated item should be considered as such
                    if (currentStatus === ApprovalStatus.PENDING || currentStatus === ApprovalStatus.RETURNED) {
                        map[t.formId]._dedupDisplayStatus = currentStatus;
                    }
                }
            });
            list = Object.values(map).map(item => ({
                ...item,
                approvalStatus: item._dedupDisplayStatus || item.approvalStatus,
                currentApprover: Array.from(item._approverSet).filter(Boolean).join(', '),
                approvalComment: item._comments.join(' | '),
                _commentsList: item._comments
            }));
        }

        if (statusFilter.length > 0) {
            list = list.filter(t => {
                if (deduplicateDetails) {
                    const gStatus = globalFormInfo[t.formId]?.status || 'PENDING';
                    const displayStatus = gStatus === 'APPROVED' ? ApprovalStatus.APPROVED :
                                          gStatus === 'REJECTED' ? ApprovalStatus.REJECTED :
                                          gStatus === 'CANCELLED' ? ApprovalStatus.CANCELLED : 
                                          gStatus === 'RETURNED' ? ApprovalStatus.RETURNED : ApprovalStatus.PENDING;
                    return statusFilter.includes(displayStatus);
                }
                return statusFilter.includes((t as any)._dedupDisplayStatus || getDisplayStatus(t, globalFormInfo[t.formId]?.status || 'PENDING'));
            });
        }
        if (formIdFilter.trim()) list = list.filter(t => t.formId.toLowerCase().includes(formIdFilter.trim().toLowerCase()));
        if (approverFilter.trim()) list = list.filter(t => (t.currentApprover||'').toLowerCase().includes(approverFilter.toLowerCase().trim()));

        return [...list].sort((a, b) => {
            let valA: any, valB: any;
            switch(sortConfig.key) {
                case 'formId': valA = a.formId; valB = b.formId; break;
                case 'status': valA = getDisplayStatus(a, globalFormInfo[a.formId]?.status || 'PENDING'); valB = getDisplayStatus(b, globalFormInfo[b.formId]?.status || 'PENDING'); break;
                case 'duration': default: valA = (a as any)._customDuration !== undefined ? (a as any)._customDuration : getDurationSeconds(a, globalFormInfo); valB = (b as any)._customDuration !== undefined ? (b as any)._customDuration : getDurationSeconds(b, globalFormInfo); break;
            }
            if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [tasks, statusFilter, formIdFilter, approverFilter, sortConfig, globalFormInfo]);

    const paginated = filteredTasks.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
    const totalPages = Math.ceil(filteredTasks.length / itemsPerPage);

    const SortIcon = ({ sortKey }: { sortKey: typeof sortConfig.key }) => (
        <span className={`ml-1 inline-block ${sortConfig.key === sortKey ? 'text-indigo-600' : 'text-slate-300'}`}>▼</span>
    );

    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[95vh] flex flex-col overflow-hidden animate-scale-in">
                <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center rounded-t-xl">
                    <div>
                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><List className="text-indigo-600" size={20}/> {title}</h3>
                        <p className="text-sm text-slate-500 mt-1">共處理 {tasks.length} 件表單紀錄</p>
                    </div>
                    <div className="flex items-center gap-3">
                        {onAnalyze && (
                            <button onClick={handleAnalyze} disabled={isAnalyzing} className="flex items-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors disabled:opacity-50 border border-indigo-100">
                                {isAnalyzing ? <RefreshCw className="animate-spin" size={16} /> : <BrainCircuit size={16} />} {analyzeLabel}
                            </button>
                        )}
                        <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full text-slate-500 transition-colors">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="p-4 border-b border-slate-200 bg-white grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                     <div>
                       <label className="text-xs font-medium text-slate-500 ml-1">目前狀態</label>
                       <MultiSelect 
                           options={Object.values(ApprovalStatus)}
                           selected={statusFilter}
                           onChange={(val) => { setStatusFilter(val); setCurrentPage(1); }}
                           placeholder="全部狀態"
                       />
                     </div>
                     <div>
                       <label className="text-xs font-medium text-slate-500 ml-1">表單編號</label>
                       <input type="text" value={formIdFilter} onChange={(e) => { setFormIdFilter(e.target.value); setCurrentPage(1); }} className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white text-slate-900 h-[38px]" placeholder="完整編號" />
                     </div>
                     <div>
                       <label className="text-xs font-medium text-slate-500 ml-1">目前簽核者</label>
                       <input type="text" value={approverFilter} onChange={(e) => { setApproverFilter(e.target.value); setCurrentPage(1); }} className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white text-slate-900 h-[38px]" placeholder="姓名關鍵字" />
                     </div>
                </div>

                <div className="flex-1 overflow-y-auto p-0 bg-slate-50 custom-scrollbar relative min-h-[300px]">
                    {aiSummary && (
                       <div className="bg-gradient-to-br from-indigo-50 to-white p-4 mx-4 mt-4 rounded-xl border border-indigo-100 shadow-sm">
                           <h4 className="flex items-center gap-2 font-bold text-indigo-900 mb-2"><BrainCircuit size={16}/> {aiTitle}</h4>
                           <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-line">{aiSummary}</p>
                       </div>
                    )}
                    
                    <table className="w-full text-sm text-left table-fixed mt-4">
                        <thead className="text-xs text-slate-500 uppercase bg-slate-100 sticky top-0 z-10 shadow-sm">
                          <tr>
                            <th className="px-3 py-3 w-[25%] cursor-pointer hover:bg-slate-200" onClick={() => setSortConfig(p => ({ key: 'formId', direction: p.direction === 'asc' ? 'desc' : 'asc' }))}>表單資訊 <SortIcon sortKey="formId"/></th>
                            <th className="px-3 py-3 w-[15%] cursor-pointer hover:bg-slate-200" onClick={() => setSortConfig(p => ({ key: 'status', direction: p.direction === 'asc' ? 'desc' : 'asc' }))}>狀態 <SortIcon sortKey="status"/></th>
                            <th className="px-3 py-3 w-[15%] cursor-pointer hover:bg-slate-200" onClick={() => setSortConfig(p => ({ key: 'duration', direction: p.direction === 'asc' ? 'desc' : 'asc' }))}>耗時 <SortIcon sortKey="duration"/></th>
                            <th className="px-3 py-3 w-[20%]">申請資訊</th>
                            <th className="px-3 py-3 w-[25%]">簽核意見</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {paginated.map((task, idx) => {
                             let st = getDisplayStatus(task, globalFormInfo[task.formId]?.status || 'PENDING');
                             if (deduplicateDetails) {
                                 const gStatus = globalFormInfo[task.formId]?.status || 'PENDING';
                                 st = gStatus === 'APPROVED' ? ApprovalStatus.APPROVED :
                                      gStatus === 'REJECTED' ? ApprovalStatus.REJECTED :
                                      gStatus === 'CANCELLED' ? ApprovalStatus.CANCELLED : 
                                      gStatus === 'RETURNED' ? ApprovalStatus.RETURNED : ApprovalStatus.PENDING;
                             }
                             const isHighlight = highlightDept && task.currentApproverDept?.includes(highlightDept);
                             return (
                                <tr key={idx} className={`transition-colors ${isHighlight ? 'bg-amber-50 hover:bg-amber-100/80 border-l-[3px] border-l-amber-400' : 'hover:bg-slate-50'}`}>
                                  <td className="px-3 py-3 align-top">
                                     <div className="flex justify-between">
                                        <span className="font-bold text-indigo-600 truncate mr-2" title={task.formId}>{task.formId}</span>
                                     </div>
                                     <div className="inline-flex text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 mt-1">{task.formName}</div>
                                     {globalFormInfo[task.formId] && (globalFormInfo[task.formId].status === 'PENDING' || globalFormInfo[task.formId].status === 'RETURNED') && (
                                         <div className="text-[10px] text-amber-600 mt-1 font-medium bg-amber-50 px-1.5 py-0.5 rounded inline-block">
                                             目前表單[{globalFormInfo[task.formId].status === 'PENDING' ? '簽核中' : '退回申請者'}]: {globalFormInfo[task.formId].currentPendingPerson || '未知'}
                                         </div>
                                     )}
                                  </td>
                                  <td className="px-3 py-3 align-top">
                                     <span className={`px-2 py-0.5 rounded text-xs font-bold inline-block mb-1 ${
                                         st === ApprovalStatus.APPROVED ? 'bg-emerald-50 text-emerald-700' :
                                         st === ApprovalStatus.REJECTED ? 'bg-red-50 text-red-700' :
                                         st === ApprovalStatus.CANCELLED ? 'bg-slate-100 text-slate-600' : 
                                          st === ApprovalStatus.RETURNED ? 'bg-amber-100 text-amber-800' : 'bg-orange-50 text-orange-700'
                                     }`}>{st}</span>
                                     <div className="text-[10px] text-slate-700 mt-1 line-clamp-1" title={`部門: ${task.currentApproverDept}`}>部門: {task.currentApproverDept || '-'}</div>
                                     <div className="text-[10px] text-slate-500 mt-0.5 line-clamp-1" title={`簽核: ${task.currentApprover}`}>{deduplicateDetails ? '簽核' : '處理'}: {task.currentApprover || '-'}</div>
                                  </td>
                                  <td className="px-3 py-3 align-top">
                                      <div className="font-mono text-indigo-600 font-medium whitespace-nowrap">{(((task as any)._customDuration !== undefined ? (task as any)._customDuration : getDurationSeconds(task)) / 86400).toFixed(2)} 天</div>
                                      <div className="text-[10px] text-slate-400 mt-1 whitespace-nowrap">{safeDate(task.stepStartTime || task.applyTime).toLocaleDateString()} 送達</div>
                                  </td>
                                  <td className="px-3 py-3 align-top">
                                      <div className="text-xs text-slate-700 truncate" title={task.applicantName}>{task.applicantName}</div>
                                      <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-2" title={task.applicantDept}>{task.applicantDept}</div>
                                  </td>
                                  <td className="px-3 py-3 align-top text-xs text-slate-600">
                                      <div className="flex flex-col gap-2 relative">
                                        {(task as any)._commentsList && (task as any)._commentsList.length > 0 ? (
                                            <ExpandableComments comments={(task as any)._commentsList} />
                                        ) : task.approvalComment ? <span className="line-clamp-3" title={task.approvalComment}>{task.approvalComment}</span> : <span className="text-slate-300">-</span>}
                                        {deduplicateDetails && (
                                            <button 
                                                onClick={() => handleSingleAnalyze(task.formId)} 
                                                disabled={analyzingFormId === task.formId}
                                                className="self-start flex items-center gap-1 text-[10px] bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-2 py-1 rounded transition-colors disabled:opacity-50 border border-indigo-100"
                                            >
                                                {analyzingFormId === task.formId ? <RefreshCw className="animate-spin" size={12} /> : <BrainCircuit size={12} />} 
                                                產生實例分析
                                            </button>
                                        )}
                                        {formSummaries[task.formId] && (
                                            <div className="p-2 bg-indigo-50/50 border border-indigo-100 rounded-md text-[10px] text-slate-700 mt-1 whitespace-pre-line leading-relaxed z-10 w-[200%] sm:w-auto -ml-[100%] sm:ml-0 shadow-sm relative">
                                                <div className="font-bold text-indigo-800 mb-1 flex items-center justify-between">
                                                    <span>AI 診斷結果</span>
                                                    <button onClick={() => setFormSummaries(p => { const next = {...p}; delete next[task.formId]; return next; })} className="text-slate-400 hover:text-slate-600"><X size={12}/></button>
                                                </div>
                                                {formSummaries[task.formId]}
                                            </div>
                                        )}
                                      </div>
                                  </td>
                                </tr>
                             );
                          })}
                          {paginated.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-slate-400">無資料</td></tr>}
                        </tbody>
                    </table>
                </div>
                {filteredTasks.length > 0 && (
                  <div className="p-3 border-t border-slate-200 bg-slate-50 flex justify-between items-center rounded-b-xl">
                    <div className="flex gap-2 items-center">
                        <span className="text-xs text-slate-500">每頁:</span>
                        <select value={itemsPerPage} onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }} className="text-xs border p-1 rounded bg-white text-slate-900 border-slate-200">
                            <option value={20}>20</option>
                            <option value={50}>50</option>
                        </select>
                    </div>
                    <div className="flex gap-2">
                        <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="p-1 border rounded bg-white disabled:opacity-50 text-slate-600 border-slate-200 hover:bg-slate-100"><X size={16} className="opacity-0 w-0"/>◀</button>
                        <span className="text-xs self-center font-medium text-slate-600"> {currentPage} / {totalPages} </span>
                        <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="p-1 border rounded bg-white disabled:opacity-50 text-slate-600 border-slate-200 hover:bg-slate-100">▶<X size={16} className="opacity-0 w-0"/></button>
                    </div>
                  </div>
                )}
            </div>
        </div>
    );
};

const TrendDetailModal: React.FC<{ 
    title: string; 
    formTasks: Record<string, ProjectTask[]>; 
    globalFormInfo: Record<string, { status: string; formName: string }>; 
    targetDept?: string;
    onClose: () => void;
}> = ({ title, formTasks, globalFormInfo, targetDept = '創新整合部', onClose }) => {
    const [expandedForms, setExpandedForms] = useState<Record<string, boolean>>({});
    
    const toggleForm = (formId: string) => {
        setExpandedForms(prev => ({ ...prev, [formId]: !prev[formId] }));
    };

    const formsList = Object.entries(formTasks).map(([formId, tasks]) => {
        const totalDuration = tasks.reduce((acc, task) => acc + getDurationSeconds(task), 0);
        const applicant = tasks[0]?.applicantName || '未知人員';
        const formCat = globalFormInfo[formId]?.formName || tasks[0]?.formName || '其他';
        return {
            formId,
            applicant,
            formCat,
            totalDuration,
            tasks
        };
    }).sort((a, b) => b.totalDuration - a.totalDuration);

    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;
    const totalPages = Math.ceil(formsList.length / itemsPerPage);
    const paginatedForms = formsList.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-[90vw] max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
                <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50/50">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <FileText size={20} className="text-indigo-600" />
                        {title} (共 {formsList.length} 件表單)
                    </h3>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                    {paginatedForms.length === 0 ? (
                        <div className="text-center text-slate-500 py-10">無任何表單</div>
                    ) : (
                        <div className="space-y-4">
                            {paginatedForms.map(f => (
                                <div key={f.formId} className="border border-slate-200 rounded-lg overflow-hidden">
                                    <div 
                                        className="bg-slate-50 p-3 flex justify-between items-center cursor-pointer hover:bg-slate-100 transition-colors"
                                        onClick={() => toggleForm(f.formId)}
                                    >
                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center gap-2">
                                                {expandedForms[f.formId] ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
                                                <span className="font-bold text-slate-800">{f.formId}</span>
                                            </div>
                                            <div className="flex gap-4 text-xs text-slate-500 pl-6">
                                                <span>申請人: {f.applicant}</span>
                                                <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded border border-indigo-100">{f.formCat}</span>
                                            </div>
                                        </div>
                                        <div className="bg-indigo-50 border border-indigo-200 text-indigo-700 font-mono text-sm px-2 py-1 rounded-md font-bold">
                                            {targetDept}共耗時 {(f.totalDuration / 86400).toFixed(2)} 天
                                        </div>
                                    </div>
                                    {expandedForms[f.formId] && (
                                        <div className="p-3 bg-white border-t border-slate-200">
                                            <table className="w-full text-left text-sm whitespace-nowrap">
                                                <thead>
                                                    <tr className="text-slate-500 border-b border-slate-100">
                                                        <th className="pb-2 font-medium w-32">簽核者</th>
                                                        <th className="pb-2 font-medium">站點名稱</th>
                                                        <th className="pb-2 font-medium w-48">意見</th>
                                                        <th className="pb-2 font-medium text-right w-24">個人耗時</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {f.tasks.map((t, idx) => (
                                                        <tr key={idx} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                                                            <td className="py-2.5 text-slate-700 font-medium">{t.currentApprover || '-'}</td>
                                                            <td className="py-2.5 text-slate-600">
                                                                <div className="line-clamp-1" title={t.rawStepStatus}>{t.rawStepStatus}</div>
                                                            </td>
                                                            <td className="py-2.5 text-slate-500 max-w-[200px] truncate" title={t.approvalComment}>
                                                                {t.approvalComment || '-'}
                                                            </td>
                                                            <td className="py-2.5 text-right font-mono text-indigo-600">
                                                                {(getDurationSeconds(t) / 86400).toFixed(2)} 天
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {totalPages > 1 && (
                  <div className="p-3 border-t border-slate-100 bg-slate-50 flex justify-end">
                    <div className="flex gap-2">
                        <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="p-1.5 border rounded-lg bg-white disabled:opacity-50 text-slate-600 border-slate-200 hover:bg-slate-100">◀</button>
                        <span className="text-sm self-center font-medium text-slate-600 px-3"> {currentPage} / {totalPages} </span>
                        <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="p-1.5 border rounded-lg bg-white disabled:opacity-50 text-slate-600 border-slate-200 hover:bg-slate-100">▶</button>
                    </div>
                  </div>
                )}
            </div>
        </div>
    );
};

export default InnovationDeptAnalysis;



