
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, ChevronDown, Check, X, CheckSquare, Square } from 'lucide-react';

export interface MultiSelectProps {
    options: string[];
    selected: string[];
    onChange: (selected: string[]) => void;
    label?: string;
    placeholder?: string;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({ options, selected, onChange, label, placeholder = "全部" }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Logic: Select All (Add all visible filtered options to selection)
    const handleSelectAll = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        
        if (search) {
            // If searching, add all SEARCHED items to existing selection (union)
            const newSelection = Array.from(new Set([...selected, ...filteredOptions]));
            onChange(newSelection);
        } else {
            // If not searching, simple Select All
            onChange([...options]);
        }
    };

    // Logic: Clear (Remove all selection)
    const handleClear = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        onChange([]);
    };

    const filteredOptions = useMemo(() => {
        if (!search) return options;
        return options.filter(opt => opt.toLowerCase().includes(search.toLowerCase()));
    }, [options, search]);

    // Optimization: Limit rendered items on mobile to prevent crash
    const renderedOptions = filteredOptions.slice(0, 100); 

    const toggleOption = (opt: string) => {
        if (selected.includes(opt)) {
            onChange(selected.filter(s => s !== opt));
        } else {
            onChange([...selected, opt]);
        }
    };

    return (
        <div className={`relative w-full ${isOpen ? 'z-[100]' : 'z-10'}`} ref={wrapperRef}>
            {label && <label className="block text-xs font-medium text-slate-500 mb-1 ml-1">{label}</label>}
            <div 
                onClick={() => { setIsOpen(!isOpen); setSearch(''); }}
                className={`flex items-center justify-between w-full px-3 py-2 bg-white border rounded-lg cursor-pointer transition-colors text-xs text-slate-700 h-[38px] ${isOpen ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-300 hover:border-indigo-400'}`}
            >
                <span className="truncate select-none">
                    {selected.length === 0 ? placeholder : 
                     selected.length === options.length ? `已全選 (${options.length})` :
                     `已選 ${selected.length} 項`}
                </span>
                <ChevronDown size={14} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </div>

            {isOpen && (
                <div className="absolute z-50 w-64 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-80 overflow-hidden flex flex-col animate-scale-in origin-top-left">
                    <div className="p-2 border-b border-slate-100 bg-slate-50 space-y-2">
                        {/* Search Input */}
                        <div className="flex items-center gap-2 bg-white px-2 py-1.5 rounded border border-slate-200 focus-within:border-indigo-400">
                            <Search size={14} className="text-slate-400" />
                            <input 
                                autoFocus
                                type="text" 
                                className="w-full text-xs outline-none text-slate-700 placeholder-slate-400 bg-transparent"
                                placeholder={`搜尋 ${options.length} 個項目...`}
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                            />
                        </div>
                        
                        {/* Action Buttons */}
                        <div className="flex justify-between gap-2">
                             <button 
                                onClick={handleSelectAll} 
                                className="flex-1 flex items-center justify-center gap-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs py-1.5 rounded transition-colors"
                             >
                                <CheckSquare size={12} />
                                全選
                             </button>
                             <button 
                                onClick={handleClear} 
                                className="flex-1 flex items-center justify-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs py-1.5 rounded transition-colors"
                             >
                                <X size={12} />
                                清空
                             </button>
                        </div>
                    </div>

                    {/* Options List */}
                    <div className="overflow-y-auto flex-1 custom-scrollbar p-1">
                        {renderedOptions.length === 0 && <div className="p-3 text-center text-xs text-slate-400">無符合項目</div>}
                        
                        {renderedOptions.map(opt => {
                            const isSelected = selected.includes(opt);
                            return (
                                <div 
                                    key={opt}
                                    className={`flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-slate-50 rounded select-none ${isSelected ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600'}`}
                                    onClick={(e) => { e.stopPropagation(); toggleOption(opt); }}
                                >
                                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 bg-white'}`}>
                                        {isSelected && <Check size={10} className="text-white" />}
                                    </div>
                                    <span className="truncate leading-tight">{opt}</span>
                                </div>
                            );
                        })}

                        {filteredOptions.length > 100 && (
                            <div className="p-2 text-center text-[10px] text-slate-400 italic bg-slate-50 mt-1">
                                僅顯示前 100 筆 (共 {filteredOptions.length} 筆)，請使用搜尋功能
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
