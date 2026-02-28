import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Download, CheckCircle, XCircle, Loader2, Key, AlertCircle, Upload, FileText, Pause, Square, Trash2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

const AutoSizer = ({ children }: { children: (props: { width: number, height: number }) => React.ReactNode }) => {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: '100%', height: '100%' }}>
      {size.width > 0 && size.height > 0 && children(size)}
    </div>
  );
};

const VirtualList = ({ 
  itemCount, 
  itemSize, 
  height, 
  width, 
  children: Row 
}: { 
  itemCount: number, 
  itemSize: number, 
  height: number, 
  width: number, 
  children: React.FC<{ index: number, style: React.CSSProperties }> 
}) => {
  const [scrollTop, setScrollTop] = useState(0);
  const totalHeight = itemCount * itemSize;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemSize) - 2);
  const endIndex = Math.min(itemCount - 1, Math.ceil((scrollTop + height) / itemSize) + 2);

  const items = [];
  for (let i = startIndex; i <= endIndex; i++) {
    items.push(
      <Row key={i} index={i} style={{ position: 'absolute', top: i * itemSize, height: itemSize, width: '100%' }} />
    );
  }

  return (
    <div 
      style={{ height, width, overflowY: 'auto', position: 'relative' }} 
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: totalHeight, width: '100%' }}>
        {items}
      </div>
    </div>
  );
};

interface KeyResult {
  key: string;
  status: 'pending' | 'validating' | 'valid' | 'invalid' | 'error';
  models: string[];
  errorMsg?: string;
}

export default function App() {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'running' | 'paused'>('idle');
  const [concurrencyLimit, setConcurrencyLimit] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [renderTrigger, setRenderTrigger] = useState(0);
  
  const resultsRef = useRef<KeyResult[]>([]);
  const statusRef = useRef<'idle' | 'running' | 'paused' | 'stopped'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastRenderTime = useRef(0);

  const triggerRender = useCallback((force = false) => {
    const now = Date.now();
    if (force || now - lastRenderTime.current > 100) {
      setRenderTrigger(v => v + 1);
      lastRenderTime.current = now;
    }
  }, []);

  useEffect(() => {
    const savedInput = localStorage.getItem('chatgpt_validator_input');
    const savedConcurrency = localStorage.getItem('chatgpt_validator_concurrency');
    if (savedInput) setInput(savedInput);
    if (savedConcurrency) setConcurrencyLimit(parseInt(savedConcurrency, 10) || 1);
    
    const savedResults = localStorage.getItem('chatgpt_validator_results');
    if (savedResults) {
      try {
        const parsed = JSON.parse(savedResults);
        resultsRef.current = parsed.map((r: KeyResult) => 
          r.status === 'validating' ? { ...r, status: 'pending' } : r
        );
        triggerRender(true);
      } catch (e) {}
    }
  }, [triggerRender]);

  useEffect(() => {
    // Only save input if it's not massively huge to prevent quota errors
    if (input.length < 1000000) {
      try {
        localStorage.setItem('chatgpt_validator_input', input);
      } catch (e) {
        console.warn('Local storage quota exceeded for input');
      }
    }
  }, [input]);

  useEffect(() => {
    // Only save results if not massively huge
    if (resultsRef.current.length < 50000) {
      try {
        localStorage.setItem('chatgpt_validator_results', JSON.stringify(resultsRef.current));
      } catch (e) {
        console.warn('Local storage quota exceeded for results');
      }
    }
  }, [renderTrigger]);

  useEffect(() => {
    localStorage.setItem('chatgpt_validator_concurrency', concurrencyLimit.toString());
  }, [concurrencyLimit]);

  const updateStatus = (newStatus: 'idle' | 'running' | 'paused' | 'stopped') => {
    statusRef.current = newStatus;
    setStatus(newStatus === 'stopped' ? 'idle' : newStatus);
  };

  const extractKeysFromText = async (file: File): Promise<string[]> => {
    const CHUNK_SIZE = 1024 * 1024 * 10; // 10MB chunks
    const keys = new Set<string>();
    let offset = 0;
    let tail = '';

    while (offset < file.size) {
      const chunk = file.slice(offset, offset + CHUNK_SIZE);
      const text = await chunk.text();
      const processText = tail + text;
      
      const lastNewline = processText.lastIndexOf('\n');
      let currentChunk = processText;
      
      if (lastNewline > 0 && offset + CHUNK_SIZE < file.size) {
        currentChunk = processText.substring(0, lastNewline);
        tail = processText.substring(lastNewline);
      } else {
        tail = '';
      }

      const matches = currentChunk.match(/sk-[a-zA-Z0-9_-]+/g);
      if (matches) {
        for (let i = 0; i < matches.length; i++) {
          keys.add(matches[i]);
        }
      }
      
      offset += CHUNK_SIZE;
      await new Promise(resolve => setTimeout(resolve, 0)); // Yield to main thread
    }
    
    if (tail) {
      const matches = tail.match(/sk-[a-zA-Z0-9_-]+/g);
      if (matches) {
        for (let i = 0; i < matches.length; i++) {
          keys.add(matches[i]);
        }
      }
    }
    
    return Array.from(keys);
  };

  const processFile = async (file: File) => {
    setIsReadingFile(true);
    await new Promise(resolve => setTimeout(resolve, 50)); // Allow UI to update
    
    const extension = file.name.split('.').pop()?.toLowerCase();
    let uniqueNewKeys: string[] = [];

    try {
      if (extension === 'txt' || extension === 'csv') {
        uniqueNewKeys = await extractKeysFromText(file);
      } else {
        let text = '';
        if (extension === 'xlsx' || extension === 'xls') {
          const arrayBuffer = await file.arrayBuffer();
          const workbook = XLSX.read(arrayBuffer, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          text = XLSX.utils.sheet_to_txt(worksheet);
        } else if (extension === 'docx') {
          const arrayBuffer = await file.arrayBuffer();
          const result = await mammoth.extractRawText({ arrayBuffer });
          text = result.value;
        } else if (extension === 'doc') {
          const buffer = await file.arrayBuffer();
          const decoder = new TextDecoder('utf-8', { fatal: false });
          text = decoder.decode(buffer);
        } else {
          alert('不支持的文件格式，请上传 txt, csv, docx, doc, xlsx 或 xls 文件');
          setIsReadingFile(false);
          return;
        }
        const matches = text.match(/sk-[a-zA-Z0-9_-]+/g) || [];
        uniqueNewKeys = Array.from(new Set(matches));
      }
      
      if (uniqueNewKeys.length > 0) {
        setInput(prev => {
          const existing = prev.trim();
          return existing ? `${existing}\n${uniqueNewKeys.join('\n')}` : uniqueNewKeys.join('\n');
        });
      } else {
        alert('未在文件中找到有效的 API Key (需以 sk- 开头)');
      }
    } catch (error) {
      console.error('Error reading file:', error);
      alert('读取文件时出错，请检查文件格式是否正确');
    } finally {
      setIsReadingFile(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await processFile(file);
    }
    event.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (status === 'idle') {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (status !== 'idle') return;
    
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processFile(file);
    }
  };

  const handleValidate = async () => {
    if (status === 'paused') {
      updateStatus('running');
      return;
    }

    // Optimized extraction from input
    const matches = input.match(/sk-[a-zA-Z0-9_-]+/g) || [];
    const uniqueKeys = Array.from(new Set(matches));
    if (uniqueKeys.length === 0) return;

    const existingKeys = resultsRef.current.map(r => r.key);
    const keysMatch = uniqueKeys.length === existingKeys.length && uniqueKeys.every((k, i) => k === existingKeys[i]);
    
    if (!keysMatch) {
      resultsRef.current = uniqueKeys.map(k => ({
        key: k,
        status: 'pending',
        models: []
      }));
      triggerRender(true);
    }

    updateStatus('running');

    const queue = resultsRef.current
      .map((r, idx) => ({ idx, status: r.status }))
      .filter(item => item.status === 'pending' || item.status === 'error')
      .map(item => item.idx);

    const CONCURRENCY = Math.max(1, Math.min(50, concurrencyLimit));

    const processNext = async () => {
      while (queue.length > 0) {
        if (statusRef.current === 'stopped') break;

        while (statusRef.current === 'paused') {
          await new Promise(resolve => setTimeout(resolve, 200));
          if (statusRef.current === 'stopped') break;
        }

        if (statusRef.current === 'stopped') break;

        const i = queue.shift();
        if (i === undefined) break;

        resultsRef.current[i].status = 'validating';
        triggerRender();
        
        try {
          const response = await fetch('https://api.openai.com/v1/models', {
            headers: {
              'Authorization': `Bearer ${uniqueKeys[i]}`
            }
          });
          
          if (statusRef.current === 'stopped') {
             resultsRef.current[i].status = 'pending';
             triggerRender();
             break;
          }

          if (response.ok) {
            const data = await response.json();
            const models = data.data
              .map((m: any) => m.id)
              .filter((m: string) => 
                m.startsWith('gpt-') || 
                m.startsWith('o1') || 
                m.startsWith('o3') || 
                m.startsWith('dall-e') || 
                m.startsWith('whisper') || 
                m.startsWith('tts') || 
                m.startsWith('text-embedding')
              );
            models.sort();
            
            resultsRef.current[i].status = 'valid';
            resultsRef.current[i].models = models;
          } else {
            let errorMsg = `HTTP ${response.status}`;
            try {
              const errData = await response.json();
              if (errData.error && errData.error.message) {
                errorMsg = errData.error.message;
              }
            } catch (e) {}
            resultsRef.current[i].status = 'invalid';
            resultsRef.current[i].errorMsg = errorMsg;
          }
        } catch (error: any) {
          resultsRef.current[i].status = 'error';
          resultsRef.current[i].errorMsg = error.message;
        }
        
        triggerRender();
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    };

    const workers = [];
    const concurrency = Math.min(CONCURRENCY, queue.length);
    for (let i = 0; i < concurrency; i++) {
      workers.push(processNext());
    }

    await Promise.all(workers);

    if (statusRef.current !== 'stopped') {
      updateStatus('idle');
      triggerRender(true);
    }
  };

  const handlePause = () => {
    updateStatus('paused');
  };

  const handleStop = () => {
    updateStatus('stopped');
    resultsRef.current.forEach(r => {
      if (r.status === 'validating') r.status = 'pending';
    });
    triggerRender(true);
  };

  const handleClear = () => {
    if (status !== 'idle') return;
    // 移除 window.confirm，因为在 iframe 环境中可能会被拦截导致按键失效
    setInput('');
    resultsRef.current = [];
    triggerRender(true);
    localStorage.removeItem('chatgpt_validator_input');
    localStorage.removeItem('chatgpt_validator_results');
  };

  const downloadValidKeys = () => {
    const validKeys = resultsRef.current.filter(r => r.status === 'valid').map(r => r.key).join('\n');
    downloadFile(validKeys, '可用key.txt');
  };

  const downloadValidKeysDetailed = () => {
    const content = resultsRef.current.filter(r => r.status === 'valid').map(r => {
      return `${r.key}\n${r.models.join(', ')}`;
    }).join('\n\n');
    downloadFile(content, '可用key(详情).txt');
  };

  const downloadFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const maskKey = (key: string) => {
    if (key.length <= 10) return '***';
    return `${key.substring(0, 7)}...${key.substring(key.length - 4)}`;
  };

  const Row = ({ index, style }: { index: number, style: React.CSSProperties }) => {
    const result = resultsRef.current[index];
    return (
      <div style={style} className="flex items-center border-b border-slate-100 hover:bg-slate-50/50 transition-colors bg-white">
        <div className="w-1/3 px-4 py-3 font-mono text-xs text-slate-600 truncate">
          {maskKey(result.key)}
        </div>
        <div className="w-28 px-4 py-3 flex-shrink-0">
          {result.status === 'pending' && <span className="inline-flex items-center text-xs text-slate-400"><Loader2 size={12} className="mr-1" /> 等待中</span>}
          {result.status === 'validating' && <span className="inline-flex items-center text-xs text-indigo-500"><Loader2 size={12} className="mr-1 animate-spin" /> 验证中</span>}
          {result.status === 'valid' && <span className="inline-flex items-center text-xs text-emerald-600"><CheckCircle size={12} className="mr-1" /> 有效</span>}
          {(result.status === 'invalid' || result.status === 'error') && (
            <span className="inline-flex items-center text-xs text-rose-500" title={result.errorMsg}>
              <XCircle size={12} className="mr-1" /> 无效
            </span>
          )}
        </div>
        <div className="flex-1 px-4 py-3 text-xs text-slate-500 truncate">
          {result.status === 'valid' ? (
            <div className="flex flex-wrap gap-1">
              {result.models.filter(m => m.includes('gpt-4') || m.includes('gpt-3.5') || m.includes('o1') || m.includes('o3')).slice(0, 5).map(m => (
                <span key={m} className="px-1.5 py-0.5 bg-slate-100 rounded text-[10px] font-mono border border-slate-200">
                  {m}
                </span>
              ))}
              {result.models.length > 5 && (
                <span className="px-1.5 py-0.5 text-[10px] text-slate-400">
                  +{result.models.length - 5} 更多
                </span>
              )}
            </div>
          ) : result.errorMsg ? (
            <span className="text-rose-400 truncate max-w-xs block" title={result.errorMsg}>
              {result.errorMsg}
            </span>
          ) : (
            '-'
          )}
        </div>
      </div>
    );
  };

  const validCount = resultsRef.current.filter(r => r.status === 'valid').length;

  return (
    <div className="min-h-screen bg-slate-50 p-6 font-sans text-slate-900">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-center space-x-3 pb-4 border-b border-slate-200">
          <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
            <Key size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">ChatGPT API Key 验证工具</h1>
            <p className="text-sm text-slate-500">批量验证 OpenAI API Key 的有效性及可用模型</p>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-medium text-slate-700">
                  输入 API Keys (每行一个)
                </label>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleClear}
                    disabled={status !== 'idle' || (!input && resultsRef.current.length === 0)}
                    className="cursor-pointer inline-flex items-center justify-center text-slate-500 hover:text-rose-600 bg-slate-50 hover:bg-rose-50 p-1.5 rounded-md transition-colors border border-slate-200 hover:border-rose-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="清除全部内容"
                    type="button"
                  >
                    <Trash2 size={14} />
                  </button>
                  <input 
                    type="file" 
                    id="file-upload" 
                    className="hidden" 
                    accept=".txt,.csv,.xlsx,.xls,.docx,.doc"
                    onChange={handleFileUpload}
                    ref={fileInputRef}
                  />
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={status !== 'idle'}
                    className="cursor-pointer inline-flex items-center space-x-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-md transition-colors border border-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    type="button"
                  >
                    <Upload size={14} />
                    <span>导入文件</span>
                  </button>
                </div>
              </div>
              
              <div 
                className={`relative w-full h-64 border rounded-lg transition-colors ${isDragging ? 'border-indigo-500 bg-indigo-50/50 ring-2 ring-indigo-500/20' : 'border-slate-300'} ${status !== 'idle' ? 'bg-slate-50' : 'bg-white'}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <textarea
                  className="w-full h-full p-3 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none bg-transparent disabled:text-slate-500"
                  placeholder="sk-...\nsk-...\n\n或将文件拖拽到此处"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={status !== 'idle'}
                />
                {isDragging && (
                  <div className="absolute inset-0 flex items-center justify-center bg-indigo-50/80 backdrop-blur-sm rounded-lg pointer-events-none z-10">
                    <div className="flex flex-col items-center text-indigo-600">
                      <Upload size={32} className="mb-2 animate-bounce" />
                      <span className="font-medium">松开鼠标导入文件</span>
                    </div>
                  </div>
                )}
                {isReadingFile && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-sm rounded-lg z-10">
                    <div className="flex flex-col items-center text-indigo-600">
                      <Loader2 size={32} className="mb-2 animate-spin" />
                      <span className="font-medium">正在解析大文件，请稍候...</span>
                    </div>
                  </div>
                )}
              </div>
              
              <div className="flex items-center space-x-3 mt-4">
                <label className="text-sm font-medium text-slate-700 whitespace-nowrap">
                  并发数:
                </label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={concurrencyLimit}
                  onChange={(e) => setConcurrencyLimit(parseInt(e.target.value) || 1)}
                  disabled={status !== 'idle'}
                  className="w-20 px-2 py-1.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none disabled:bg-slate-50 disabled:text-slate-500"
                />
                <span className="text-xs text-slate-500">推荐5并发</span>
              </div>
              
              {status === 'idle' ? (
                <button
                  onClick={handleValidate}
                  disabled={input.trim().length === 0}
                  className="mt-4 w-full flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 px-4 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Play size={18} />
                  <span>开始验证</span>
                </button>
              ) : (
                <div className="mt-4 flex space-x-2">
                  {status === 'running' ? (
                    <button
                      onClick={handlePause}
                      className="flex-1 flex items-center justify-center space-x-2 bg-amber-500 hover:bg-amber-600 text-white py-2.5 px-4 rounded-lg font-medium transition-colors"
                    >
                      <Pause size={18} />
                      <span>暂停</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleValidate}
                      className="flex-1 flex items-center justify-center space-x-2 bg-emerald-500 hover:bg-emerald-600 text-white py-2.5 px-4 rounded-lg font-medium transition-colors"
                    >
                      <Play size={18} />
                      <span>继续</span>
                    </button>
                  )}
                  <button
                    onClick={handleStop}
                    className="flex-1 flex items-center justify-center space-x-2 bg-rose-500 hover:bg-rose-600 text-white py-2.5 px-4 rounded-lg font-medium transition-colors"
                  >
                    <Square size={18} />
                    <span>终止</span>
                  </button>
                </div>
              )}
            </div>

            {validCount > 0 && (
              <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 space-y-3">
                <h3 className="text-sm font-medium text-slate-700">导出结果</h3>
                <button
                  onClick={downloadValidKeys}
                  className="w-full flex items-center justify-center space-x-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 py-2 px-4 rounded-lg text-sm font-medium transition-colors"
                >
                  <Download size={16} />
                  <span>下载 可用key.txt</span>
                </button>
                <button
                  onClick={downloadValidKeysDetailed}
                  className="w-full flex items-center justify-center space-x-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 py-2 px-4 rounded-lg text-sm font-medium transition-colors"
                >
                  <Download size={16} />
                  <span>下载 可用key(详情).txt</span>
                </button>
              </div>
            )}
          </div>

          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-full min-h-[400px]">
              <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                <h2 className="text-sm font-medium text-slate-700">验证结果</h2>
                <div className="text-xs text-slate-500">
                  共 {resultsRef.current.length} 个 / 有效 {validCount} 个
                </div>
              </div>
              
              <div className="flex-1 flex flex-col relative bg-slate-50/30">
                {resultsRef.current.length === 0 ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 p-8">
                    <FileText size={32} className="mb-2 opacity-50" />
                    <p className="text-sm">暂无数据，请在左侧输入 Key 或导入文件并点击验证</p>
                  </div>
                ) : (
                  <>
                    <div className="flex bg-slate-50/80 text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200 font-medium">
                      <div className="w-1/3 px-4 py-3">API Key</div>
                      <div className="w-28 px-4 py-3">状态</div>
                      <div className="flex-1 px-4 py-3">可用模型 (摘要)</div>
                    </div>
                    <div className="flex-1 relative">
                      <AutoSizer>
                        {({ height, width }) => (
                          <VirtualList
                            height={height}
                            itemCount={resultsRef.current.length}
                            itemSize={48}
                            width={width}
                          >
                            {Row}
                          </VirtualList>
                        )}
                      </AutoSizer>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
