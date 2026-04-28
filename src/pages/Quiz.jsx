import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { getStroke } from 'perfect-freehand';
import { loadQuiz } from '../utils/loadQuiz';
import { useAuth } from '../context/AuthContext';
import { doc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

function getSvgPathFromStroke(stroke) {
  if (!stroke.length) return "";
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...stroke[0], "Q"]
  );
  d.push("Z");
  return d.join(" ");
}

function Quiz() {
  const { subjectName, chapterId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  // --- Dynamic Data State ---
  const [quizData, setQuizData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // --- Quiz Interaction State ---
  const [current, setCurrent] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [showExp, setShowExp] = useState({});
  const [savedExplanations, setSavedExplanations] = useState({});
  const [notes, setNotes] = useState({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);

  // --- Retake State ---
  const [isRetakeMode, setIsRetakeMode] = useState(false);
  const [retakeAnswers, setRetakeAnswers] = useState({});
  const [retakeSubmitted, setRetakeSubmitted] = useState(false);

  // --- Drawing & Highlight State ---
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [isHighlightMode, setIsHighlightMode] = useState(false);
  const [drawTool, setDrawTool] = useState('pen');
  const [penColor, setPenColor] = useState('#FF003C');
  const [highlightColor, setHighlightColor] = useState('#FFF800');
  const [penWidth, setPenWidth] = useState(3);
  const [activeMenu, setActiveMenu] = useState(null); // Tracks open pop-up menus

  const [drawings, setDrawings] = useState({});
  const [historyState, setHistoryState] = useState({});

  // --- DYNAMIC ZOOM-RESILIENT TOOLBAR STATE ---
  const [toolbarStyle, setToolbarStyle] = useState({
    position: 'fixed',
    top: '15px',
    left: '50%',
    transform: 'translateX(-50%)',
    transformOrigin: 'top center',
    zIndex: 10000,
    width: 'max-content'
  });

  const activePointers = useRef(new Set());
  const canvasRefs = useRef({});
  const previewCanvasRefs = useRef({});
  const undoHistoryRefs = useRef({});
  const redoHistoryRefs = useRef({});
  const questionContainersRef = useRef({});
  const explanationRefs = useRef({});
  const activeCanvasIndex = useRef(null);
  const isDrawing = useRef(false);

  const pendingUpdatesRef = useRef({});

  // Snapshots and Auto-Snap Refs
  const startX = useRef(0);
  const startY = useRef(0);
  const snapshot = useRef(null);
  const strokePoints = useRef([]);
  const holdTimeout = useRef(null);
  const preStrokeSnapshot = useRef(null);
  const lastPos = useRef({ x: 0, y: 0 });
  const isSnapped = useRef(false);
  const isHighlightErased = useRef(false);
  const activePointerType = useRef(null);

  const updateHistoryState = (index) => {
    setHistoryState(prev => ({
      ...prev,
      [index]: {
        undo: undoHistoryRefs.current[index]?.length || 0,
        redo: redoHistoryRefs.current[index]?.length || 0
      }
    }));
  };

  // --- PINCH ZOOM TOOLBAR TRACKER ---
  useEffect(() => {
    const updateToolbar = () => {
      if (window.visualViewport) {
        const vv = window.visualViewport;
        setToolbarStyle({
          position: 'fixed',
          top: `${vv.offsetTop + 15}px`,
          left: `${vv.offsetLeft + (vv.width / 2)}px`,
          transform: `translate(-50%, 0) scale(${1 / vv.scale})`,
          transformOrigin: 'top center',
          zIndex: 10000,
          width: 'max-content'
        });
      }
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateToolbar);
      window.visualViewport.addEventListener('scroll', updateToolbar);
      updateToolbar();
    }

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateToolbar);
        window.visualViewport.removeEventListener('scroll', updateToolbar);
      }
    };
  }, []);

  useEffect(() => {
    loadQuiz(subjectName, chapterId).then(data => {
      setQuizData(data);
      setLoading(false);
    });
  }, [subjectName, chapterId]);

  useEffect(() => {
    if (!user || !subjectName || !chapterId) {
      setIsInitialLoadComplete(true);
      return;
    }

    const docRef = doc(db, 'users', user.uid, 'quizzes', `${subjectName}-${chapterId}`);

    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists() && !docSnap.metadata.hasPendingWrites) {
        const data = docSnap.data();
        if (data.drawings !== undefined) setDrawings(data.drawings);
        if (data.savedExplanations !== undefined) setSavedExplanations(data.savedExplanations);
        if (data.notes !== undefined) setNotes(data.notes);
        if (data.selectedAnswers !== undefined) setSelectedAnswers(data.selectedAnswers);
        if (data.showExp !== undefined) setShowExp(data.showExp);
        if (data.current !== undefined) setCurrent(data.current);
        if (data.isSubmitted !== undefined) setIsSubmitted(data.isSubmitted);
      } else if (!docSnap.exists()) {
        setCurrent(0);
        setDrawings({});
        setSavedExplanations({});
        setSelectedAnswers({});
        setShowExp({});
        setIsSubmitted(false);

        setDoc(docRef, {
          current: 0, drawings: {}, savedExplanations: {}, selectedAnswers: {}, showExp: {}, isSubmitted: false
        }).catch(err => console.error("Error creating initial document:", err));
      }
      setIsInitialLoadComplete(true);
    }, (error) => {
      console.error("Error listening to progress:", error);
      setIsInitialLoadComplete(true);
    });

    return () => unsubscribe();
  }, [user, subjectName, chapterId]);

  // MANUAL SAVE & REFRESH WARNING
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "You have unsaved changes. Are you sure you want to leave without saving?";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (user && Object.keys(pendingUpdatesRef.current).length > 0) {
        const docRef = doc(db, 'users', user.uid, 'quizzes', `${subjectName}-${chapterId}`);
        updateDoc(docRef, pendingUpdatesRef.current).catch(() => { });
      }
    };
  }, [hasUnsavedChanges, user, subjectName, chapterId]);

  const queueUpdate = (updates) => {
    if (!user) {
      if (!window.hasAlertedForLoginGeneral) {
        alert("You are not logged in! Progress cannot be saved.");
        window.hasAlertedForLoginGeneral = true;
      }
      return;
    }
    pendingUpdatesRef.current = { ...pendingUpdatesRef.current, ...updates };
    setHasUnsavedChanges(true);
  };

  const manualSaveToCloud = async () => {
    if (!user || Object.keys(pendingUpdatesRef.current).length === 0) return;

    setIsSaving(true);
    const updatesToApply = { ...pendingUpdatesRef.current };
    pendingUpdatesRef.current = {};
    const docRef = doc(db, 'users', user.uid, 'quizzes', `${subjectName}-${chapterId}`);

    try {
      await updateDoc(docRef, updatesToApply);
      setHasUnsavedChanges(false);
    } catch (error) {
      if (error.code === 'not-found' || String(error).includes('not-found')) {
        try {
          await setDoc(docRef, updatesToApply);
          setHasUnsavedChanges(false);
        } catch (setDocError) {
          console.error("Error creating document:", setDocError);
          pendingUpdatesRef.current = { ...updatesToApply, ...pendingUpdatesRef.current };
          setHasUnsavedChanges(true);
        }
      } else {
        console.error("Error syncing progress:", error);
        pendingUpdatesRef.current = { ...updatesToApply, ...pendingUpdatesRef.current };
        setHasUnsavedChanges(true);
      }
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!quizData) return;

    quizData.questions.forEach((_, index) => {
      if (!isSubmitted && index !== current) return;

      const canvas = canvasRefs.current[index];
      const container = questionContainersRef.current[index];

      if (canvas && container) {
        const ratio = window.devicePixelRatio || 1;
        const targetWidth = Math.round(container.offsetWidth * ratio);
        const targetHeight = Math.round(container.offsetHeight * ratio);

        const needsResize = canvas.width !== targetWidth || canvas.height !== targetHeight;

        if (needsResize || (drawings[index] && canvas.dataset.loaded !== drawings[index])) {
          if (needsResize) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            canvas.style.width = `${container.offsetWidth}px`;
            canvas.style.height = `${container.offsetHeight}px`;
          }

          const ctx = canvas.getContext('2d', { alpha: true });
          ctx.imageSmoothingEnabled = false; // Disable blurring for ultra-sharp lines
          if (needsResize) ctx.scale(ratio, ratio);
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (drawings[index]) {
            const img = new Image();
            img.src = drawings[index];
            img.onload = () => {
              const ctx = canvas.getContext('2d');
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(img, 0, 0, container.offsetWidth, container.offsetHeight);
            };
            canvas.dataset.loaded = drawings[index];
          } else {
            canvas.dataset.loaded = "empty";
          }
        }
      }
    });
  }, [current, isDrawingMode, quizData, isSubmitted, isInitialLoadComplete, drawings, showExp]);

  const handleQuestionChange = (newIndex) => {
    setCurrent(newIndex);
    setIsDrawingMode(false);
    setIsHighlightMode(false);
    setActiveMenu(null);
    if (!isRetakeMode) queueUpdate({ current: newIndex });
  };

  const handleShowExplanation = (index) => {
    setShowExp(prev => ({ ...prev, [index]: true }));
    queueUpdate({ showExp: { ...showExp, [index]: true }, current: current });
  };

  const nextQuestion = () => { if (current < questions.length - 1) handleQuestionChange(current + 1); };
  const prevQuestion = () => { if (current > 0) handleQuestionChange(current - 1); };

  const submitQuiz = () => {
    let newDrawings = drawings;
    setIsSubmitted(true);
    queueUpdate({ drawings: newDrawings, isSubmitted: true });
  };

  const handleClick = (qIdx, optIdx) => {
    if (isRetakeMode) {
      if (retakeSubmitted) return;
      setRetakeAnswers(prev => {
        let newAnswers = { ...prev };
        if (prev[qIdx] === optIdx) delete newAnswers[qIdx];
        else newAnswers[qIdx] = optIdx;
        return newAnswers;
      });
      return;
    }

    if (isSubmitted || isDrawingMode || showExp[qIdx]) return;

    setSelectedAnswers(prevAnswers => {
      const newSelectedAnswers = { ...prevAnswers, [qIdx]: optIdx };
      queueUpdate({ selectedAnswers: newSelectedAnswers, current: current });
      return newSelectedAnswers;
    });
  };

  const snapShape = () => {
    const points = strokePoints.current;
    if (points.length < 15) return;

    const start = points[0];
    const end = points[points.length - 1];

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const width = maxX - minX;
    const height = maxY - minY;
    const diag = Math.hypot(width, height);
    const gap = Math.hypot(start.x - end.x, start.y - end.y);

    const canvas = canvasRefs.current[activeCanvasIndex.current];
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(preStrokeSnapshot.current, 0, 0);
    ctx.beginPath();
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = penColor;
    ctx.lineWidth = penWidth;
    ctx.shadowBlur = 1;
    ctx.shadowColor = penColor;

    const isClosedShape = gap < diag * 0.3;

    if (isClosedShape) {
      const aspect = Math.min(width, height) / Math.max(width, height);
      if (aspect > 0.7) {
        const centerX = minX + width / 2;
        const centerY = minY + height / 2;
        const radius = Math.max(width, height) / 2;
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      } else {
        ctx.rect(minX, minY, width, height);
      }
    } else {
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
    }

    ctx.stroke();
    isSnapped.current = true;
  };

  const startDrawing = (e, index) => {
    const { nativeEvent } = e;
    if (!isDrawingMode) return;
    if (!user && !window.hasAlertedForLoginScratchpad) {
      alert("Please log in with Google to save your notes permanently.");
      window.hasAlertedForLoginScratchpad = true;
    }

    if (activeMenu) setActiveMenu(null);

    // Palm Rejection: If a pen is used, ignore touches
    if (activePointerType.current === 'pen' && nativeEvent.pointerType === 'touch') return;
    activePointerType.current = nativeEvent.pointerType;

    activeCanvasIndex.current = index;
    const { clientX, clientY, pressure } = nativeEvent;

    const isDrawingAllowed = isRetakeMode ? retakeSubmitted : (isSubmitted || showExp[index]);
    if (!isDrawingAllowed) return;

    const canvas = canvasRefs.current[index];
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const offsetX = clientX - rect.left;
    const offsetY = clientY - rect.top;
    lastPos.current = { x: clientX, y: clientY };

    const ctx = canvas.getContext('2d');
    isSnapped.current = false;
    startX.current = offsetX;
    startY.current = offsetY;

    const state = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const expRef = explanationRefs.current[index];
    const htmlState = expRef ? expRef.innerHTML : "";

    preStrokeSnapshot.current = state;
    snapshot.current = state;

    if (!undoHistoryRefs.current[index]) undoHistoryRefs.current[index] = [];
    undoHistoryRefs.current[index].push({ canvas: state, html: htmlState });
    if (undoHistoryRefs.current[index].length > 20) undoHistoryRefs.current[index].shift();

    redoHistoryRefs.current[index] = [];
    strokePoints.current = [{ x: offsetX, y: offsetY, pressure: pressure || 0.5 }];
    isDrawing.current = true;
    updateHistoryState(index);

    // Prepare Preview Canvas
    const previewCanvas = previewCanvasRefs.current[index];
    if (previewCanvas) {
      const ratio = window.devicePixelRatio || 1;
      if (previewCanvas.width !== canvas.width || previewCanvas.height !== canvas.height) {
        previewCanvas.width = canvas.width;
        previewCanvas.height = canvas.height;
        previewCanvas.style.width = canvas.style.width;
        previewCanvas.style.height = canvas.style.height;
      }
      const pCtx = previewCanvas.getContext('2d', { alpha: true });
      pCtx.imageSmoothingEnabled = false; // Maintain sharpness during live drawing
      pCtx.setTransform(1, 0, 0, 1, 0, 0);
      pCtx.scale(ratio, ratio);
      pCtx.clearRect(0, 0, canvas.width, canvas.height);
    }

    ctx.beginPath();
    ctx.moveTo(offsetX, offsetY);
  };

  const draw = (e, index) => {
    const { nativeEvent } = e;
    if (!isDrawing.current || !isDrawingMode || activeCanvasIndex.current !== index) return;
    const canvas = canvasRefs.current[index];
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const offsetX = nativeEvent.clientX - rect.left;
    const offsetY = nativeEvent.clientY - rect.top;

    strokePoints.current.push({ x: offsetX, y: offsetY, pressure: nativeEvent.pressure || 0.5 });
    const pts = strokePoints.current;

    const drawSmoothCurve = () => {
      const previewCanvas = previewCanvasRefs.current[index];
      const pCtx = previewCanvas?.getContext('2d');

      if (drawTool === 'pen' && pCtx) {
        // Advanced Smoothing with perfect-freehand on the PREVIEW layer
        pCtx.clearRect(0, 0, canvas.width, canvas.height);

        const stroke = getStroke(pts, {
          size: penWidth,
          thinning: 0.8,

          // INCREASE THESE TWO VALUES:
          smoothing: 0.8,   // Previously 0.5. Try 0.8 to 0.95
          streamline: 0.9, // Previously 0.5. Try 0.8 to 0.95

          simulatePressure: nativeEvent.pointerType !== 'pen'
        });

        const pathData = getSvgPathFromStroke(stroke);
        const path = new Path2D(pathData);
        pCtx.globalCompositeOperation = 'source-over';
        pCtx.fillStyle = penColor;
        pCtx.fill(path);
      } else {
        // Fallback or other tools on main ctx (or preview if appropriate)
        if (pts.length >= 3) {
          const prev = pts[pts.length - 3];
          const mid1 = { x: (prev.x + pts[pts.length - 2].x) / 2, y: (prev.y + pts[pts.length - 2].y) / 2 };
          const mid2 = { x: (pts[pts.length - 2].x + offsetX) / 2, y: (pts[pts.length - 2].y + offsetY) / 2 };
          ctx.beginPath();
          ctx.moveTo(mid1.x, mid1.y);
          ctx.quadraticCurveTo(pts[pts.length - 2].x, pts[pts.length - 2].y, mid2.x, mid2.y);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(offsetX, offsetY);
          ctx.stroke();
        }
      }
    };

    if (drawTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = 25;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowBlur = 0;
      drawSmoothCurve();

      const expRef = explanationRefs.current[index];
      if (expRef) {
        const spans = expRef.querySelectorAll('span[style*="background-color"]');
        spans.forEach(span => {
          const rects = span.getClientRects();
          let hit = false;
          for (let i = 0; i < rects.length; i++) {
            const rect = rects[i];
            if (nativeEvent.clientX >= rect.left - 5 && nativeEvent.clientX <= rect.right + 5 &&
              nativeEvent.clientY >= rect.top - 5 && nativeEvent.clientY <= rect.bottom + 5) {
              hit = true;
              break;
            }
          }
          if (hit) {
            const parent = span.parentNode;
            while (span.firstChild) {
              parent.insertBefore(span.firstChild, span);
            }
            parent.removeChild(span);
            isHighlightErased.current = true;
          }
        });
      }

    } else if (drawTool === 'pen') {
      if (isSnapped.current) return;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = penColor;
      ctx.lineWidth = penWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowBlur = 0.5;
      ctx.shadowColor = penColor;
      drawSmoothCurve();

      clearTimeout(holdTimeout.current);
      holdTimeout.current = setTimeout(() => {
        if (isDrawing.current && !isSnapped.current) snapShape();
      }, 600);

    } else {
      ctx.putImageData(snapshot.current, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = penColor;
      ctx.lineWidth = penWidth;
      ctx.shadowBlur = 1;
      ctx.shadowColor = penColor;
      ctx.beginPath();

      if (drawTool === 'line') {
        ctx.moveTo(startX.current, startY.current);
        ctx.lineTo(offsetX, offsetY);
      } else if (drawTool === 'rectangle') {
        const width = offsetX - startX.current;
        const height = offsetY - startY.current;
        ctx.rect(startX.current, startY.current, width, height);
      } else if (drawTool === 'circle') {
        const radius = Math.sqrt(Math.pow(offsetX - startX.current, 2) + Math.pow(offsetY - startY.current, 2));
        ctx.arc(startX.current, startY.current, radius, 0, 2 * Math.PI);
      }
      ctx.stroke();
    }
  };

  const stopDrawing = (index, clientX, clientY) => {
    if (activeCanvasIndex.current !== index) return;
    clearTimeout(holdTimeout.current);

    if (isDrawing.current && clientX !== undefined && clientY !== undefined) {
      const dist = Math.sqrt(Math.pow(clientX - lastPos.current.x, 2) + Math.pow(clientY - lastPos.current.y, 2));
      if (dist < 5) {
        const elements = document.elementsFromPoint(clientX, clientY);
        const targetBtn = elements.find(el => el.tagName === 'BUTTON' || el.getAttribute('data-tap-btn') === 'true');
        if (targetBtn) {
          const qIdx = parseInt(targetBtn.getAttribute('data-q-index'));
          const optIdx = parseInt(targetBtn.getAttribute('data-opt-index'));
          if (!isNaN(qIdx) && !isNaN(optIdx)) {
            handleClick(qIdx, optIdx);
          } else {
            targetBtn.click();
          }
        }
      }
    }

    isDrawing.current = false;
    const canvas = canvasRefs.current[index];
    const previewCanvas = previewCanvasRefs.current[index];
    const ctx = canvas?.getContext('2d');
    if (ctx) ctx.closePath();

    if (previewCanvas && canvas && drawTool === 'pen') {
      // Bake the preview stroke into the main canvas
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false; // Prevent blurring when merging layers
      ctx.drawImage(previewCanvas, 0, 0, canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1));
      // Clear preview
      const pCtx = previewCanvas.getContext('2d');
      pCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    }

    if (canvas) {
      const newDrawUrl = canvas.toDataURL();
      setDrawings(prev => {
        const newDrawings = { ...prev, [index]: newDrawUrl };
        if (!isHighlightErased.current) queueUpdate({ drawings: newDrawings });
        return newDrawings;
      });
      canvas.dataset.loaded = newDrawUrl;
    }

    if (isHighlightErased.current) {
      const expRef = explanationRefs.current[index];
      if (expRef) {
        setSavedExplanations(prev => {
          const newExplanations = { ...prev, [index]: expRef.innerHTML };
          setDrawings(prevDrawings => {
            queueUpdate({ drawings: prevDrawings, savedExplanations: newExplanations });
            return prevDrawings;
          });
          return newExplanations;
        });
      }
      isHighlightErased.current = false;
    }
    activeCanvasIndex.current = null;
  };

  const abortDrawing = (index) => {
    if (!isDrawing.current || activeCanvasIndex.current !== index) return;
    clearTimeout(holdTimeout.current);
    isDrawing.current = false;

    const canvas = canvasRefs.current[index];
    const ctx = canvas?.getContext('2d');

    if (ctx && preStrokeSnapshot.current) {
      ctx.putImageData(preStrokeSnapshot.current, 0, 0);
    }

    const expRef = explanationRefs.current[index];
    if (expRef && undoHistoryRefs.current[index] && undoHistoryRefs.current[index].length > 0) {
      const lastState = undoHistoryRefs.current[index][undoHistoryRefs.current[index].length - 1];
      if (lastState && lastState.html !== undefined) {
        expRef.innerHTML = lastState.html;
      }
      undoHistoryRefs.current[index].pop();
    }

    updateHistoryState(index);
    activeCanvasIndex.current = null;
  };

  const handleUndo = (index) => {
    if (!undoHistoryRefs.current[index] || undoHistoryRefs.current[index].length === 0) return;
    const canvas = canvasRefs.current[index];
    const ctx = canvas?.getContext('2d');
    const expRef = explanationRefs.current[index];

    const currentCanvasState = ctx ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
    const currentHtmlState = expRef ? expRef.innerHTML : "";

    if (!redoHistoryRefs.current[index]) redoHistoryRefs.current[index] = [];
    redoHistoryRefs.current[index].push({ canvas: currentCanvasState, html: currentHtmlState });

    const prevState = undoHistoryRefs.current[index].pop();
    updateHistoryState(index);

    let newDrawUrl = null;
    let newHtml = null;

    if (ctx && prevState.canvas) {
      ctx.putImageData(prevState.canvas, 0, 0);
      newDrawUrl = canvas.toDataURL();
      canvas.dataset.loaded = newDrawUrl;
    }

    if (expRef && prevState.html !== undefined) {
      expRef.innerHTML = prevState.html;
      newHtml = prevState.html;
    }

    setDrawings(prevD => {
      const nextD = newDrawUrl !== null ? { ...prevD, [index]: newDrawUrl } : prevD;
      setSavedExplanations(prevE => {
        const nextE = newHtml !== null ? { ...prevE, [index]: newHtml } : prevE;
        if (!isRetakeMode) {
          const updates = {};
          if (newDrawUrl !== null) updates.drawings = nextD;
          if (newHtml !== null) updates.savedExplanations = nextE;
          if (Object.keys(updates).length > 0) queueUpdate(updates);
        }
        return nextE;
      });
      return nextD;
    });
  };

  const handleRedo = (index) => {
    if (!redoHistoryRefs.current[index] || redoHistoryRefs.current[index].length === 0) return;
    const canvas = canvasRefs.current[index];
    const ctx = canvas?.getContext('2d');
    const expRef = explanationRefs.current[index];

    const currentCanvasState = ctx ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
    const currentHtmlState = expRef ? expRef.innerHTML : "";

    if (!undoHistoryRefs.current[index]) undoHistoryRefs.current[index] = [];
    undoHistoryRefs.current[index].push({ canvas: currentCanvasState, html: currentHtmlState });

    const nextState = redoHistoryRefs.current[index].pop();
    updateHistoryState(index);

    let newDrawUrl = null;
    let newHtml = null;

    if (ctx && nextState.canvas) {
      ctx.putImageData(nextState.canvas, 0, 0);
      newDrawUrl = canvas.toDataURL();
      canvas.dataset.loaded = newDrawUrl;
    }

    if (expRef && nextState.html !== undefined) {
      expRef.innerHTML = nextState.html;
      newHtml = nextState.html;
    }

    setDrawings(prevD => {
      const nextD = newDrawUrl !== null ? { ...prevD, [index]: newDrawUrl } : prevD;
      setSavedExplanations(prevE => {
        const nextE = newHtml !== null ? { ...prevE, [index]: newHtml } : prevE;
        if (!isRetakeMode) {
          const updates = {};
          if (newDrawUrl !== null) updates.drawings = nextD;
          if (newHtml !== null) updates.savedExplanations = nextE;
          if (Object.keys(updates).length > 0) queueUpdate(updates);
        }
        return nextE;
      });
      return nextD;
    });
  };

  const clearPage = (index) => {
    const canvas = canvasRefs.current[index];
    const expRef = explanationRefs.current[index];

    const canvasState = canvas ? canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height) : null;
    const htmlState = expRef ? expRef.innerHTML : "";

    if (!undoHistoryRefs.current[index]) undoHistoryRefs.current[index] = [];
    undoHistoryRefs.current[index].push({ canvas: canvasState, html: htmlState });
    if (undoHistoryRefs.current[index].length > 20) undoHistoryRefs.current[index].shift();
    redoHistoryRefs.current[index] = [];
    updateHistoryState(index);

    if (canvas) {
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      canvas.dataset.loaded = "empty";
    }
    if (expRef) expRef.innerHTML = questions[index].explanation;

    setDrawings(prev => {
      const newDrawings = { ...prev };
      delete newDrawings[index];
      setSavedExplanations(prevExp => {
        const newExplanations = { ...prevExp };
        delete newExplanations[index];
        queueUpdate({ drawings: newDrawings, savedExplanations: newExplanations });
        return newExplanations;
      });
      return newDrawings;
    });
  };

  const startFreshRetainNotes = () => {
    if (window.confirm("Start fresh? Your drawings and highlights will be safely hidden until you check the answers.")) {
      setIsSubmitted(false);
      setSelectedAnswers({});
      setShowExp({});
      setCurrent(0);
      setIsRetakeMode(false);
      setIsDrawingMode(false);
      setIsHighlightMode(false);
      queueUpdate({ isSubmitted: false, selectedAnswers: {}, showExp: {}, current: 0 });
    }
  };

  const clearAnnotations = () => {
    if (window.confirm("Are you sure you want to clear ALL drawings and highlights from every page?")) {
      setDrawings({});
      setSavedExplanations({});
      setSelectedAnswers({});
      setShowExp({});
      setIsSubmitted(false);
      setCurrent(0);

      undoHistoryRefs.current = {};
      redoHistoryRefs.current = {};
      setHistoryState({});

      questions.forEach((_, index) => {
        const canvas = canvasRefs.current[index];
        if (canvas) {
          canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
          canvas.dataset.loaded = "empty";
        }
        const expRef = explanationRefs.current[index];
        if (expRef) expRef.innerHTML = questions[index].explanation;
      });
      queueUpdate({ drawings: {}, savedExplanations: {}, selectedAnswers: {}, showExp: {}, isSubmitted: false, current: 0 });
    }
  };

  const handleMouseUp = (index) => {
    if (!isSubmitted && !showExp[index]) return;
    if (isDrawingMode || !isHighlightMode) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (range.toString().trim().length === 0) return;

    if (!user && !window.hasAlertedForLoginHighlight) {
      alert("Please log in with Google to save your highlights permanently.");
      window.hasAlertedForLoginHighlight = true;
    }

    const expRef = explanationRefs.current[index];
    if (!expRef) return;

    const htmlState = expRef.innerHTML;
    const canvas = canvasRefs.current[index];
    const canvasState = canvas ? canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height) : null;

    if (!undoHistoryRefs.current[index]) undoHistoryRefs.current[index] = [];
    undoHistoryRefs.current[index].push({ canvas: canvasState, html: htmlState });
    if (undoHistoryRefs.current[index].length > 20) undoHistoryRefs.current[index].shift();
    redoHistoryRefs.current[index] = [];
    updateHistoryState(index);

    try {
      const span = document.createElement("span");
      span.style.backgroundColor = highlightColor;
      span.style.transition = "background-color 0.3s ease";
      span.style.borderRadius = "2px";
      span.style.padding = "2px 0";

      range.surroundContents(span);
      selection.removeAllRanges();

      setSavedExplanations(prev => {
        const newExplanations = { ...prev, [index]: expRef.innerHTML };
        queueUpdate({ savedExplanations: newExplanations });
        return newExplanations;
      });
    } catch (err) {
      undoHistoryRefs.current[index].pop();
      updateHistoryState(index);
      console.log("Cross-node highlighting block:", err);
    }
  };

  const clearHighlight = (index) => {
    const expRef = explanationRefs.current[index];
    if (!expRef) return;

    const htmlState = expRef.innerHTML;
    const canvas = canvasRefs.current[index];
    const canvasState = canvas ? canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height) : null;

    if (!undoHistoryRefs.current[index]) undoHistoryRefs.current[index] = [];
    undoHistoryRefs.current[index].push({ canvas: canvasState, html: htmlState });
    if (undoHistoryRefs.current[index].length > 20) undoHistoryRefs.current[index].shift();
    redoHistoryRefs.current[index] = [];
    updateHistoryState(index);

    setSavedExplanations(prev => {
      const newExplanations = { ...prev };
      delete newExplanations[index];
      queueUpdate({ savedExplanations: newExplanations });
      return newExplanations;
    });

    expRef.innerHTML = questions[index].explanation;
  };

  const getCustomCursor = () => {
    if (!isDrawingMode) return 'default';
    if (drawTool === 'eraser') return `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2"><circle cx="12" cy="12" r="10" fill="white" opacity="0.8"/></svg>') 12 12, cell`;

    const color = penColor;
    const size = penWidth;
    const opacity = 1;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size + 4}" height="${size + 4}" viewBox="0 0 ${size + 4} ${size + 4}"><circle cx="${(size + 4) / 2}" cy="${(size + 4) / 2}" r="${size / 2}" fill="${encodeURIComponent(color)}" fill-opacity="${opacity}" stroke="rgba(0,0,0,0.1)" stroke-width="1"/></svg>`;
    return `url('data:image/svg+xml;utf8,${svg}') ${(size + 4) / 2} ${(size + 4) / 2}, crosshair`;
  };

  const downloadPDF = async () => {
    setIsDownloading(true);
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const margin = 10;
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const contentWidth = pdfWidth - (margin * 2);
      let currentY = margin;

      // 1. Force drawings visibility
      questions.forEach((_, i) => {
        if (canvasRefs.current[i]) canvasRefs.current[i].style.opacity = "1";
      });

      // 2. Process in batches for balanced speed and stability
      const BATCH_SIZE = 8;

      for (let i = 0; i < questions.length; i += BATCH_SIZE) {
        const batchPromises = questions.slice(i, i + BATCH_SIZE).map(async (_, index) => {
          const qIdx = i + index;
          const el = questionContainersRef.current[qIdx];
          if (!el) return null;

          const canvas = await html2canvas(el, {
            scale: 2, // Maintain ultra-sharp resolution
            useCORS: true,
            logging: false,
            backgroundColor: "#ffffff",
          });

          return {
            imgData: canvas.toDataURL("image/jpeg", 0.95), // JPEG 0.95 is much faster than PNG
            imgHeight: (canvas.height * contentWidth) / canvas.width
          };
        });

        const results = await Promise.all(batchPromises);

        // Add results to PDF while managing page breaks
        for (const res of results) {
          if (!res) continue;
          const { imgData, imgHeight } = res;

          if (currentY + imgHeight > pdfHeight - margin) {
            pdf.addPage();
            currentY = margin;
          }

          pdf.addImage(imgData, 'JPEG', margin, currentY, contentWidth, imgHeight, undefined, 'FAST');
          currentY += imgHeight + 6; // Spacing between questions
        }
      }

      pdf.save(`${subjName}_Study_Notes.pdf`);
    } catch (error) {
      console.error("PDF Generation Error:", error);
      alert("PDF generation failed. This usually happens if the quiz is extremely long. Your notes are safe, but the PDF export limit was reached.");
    } finally {
      setIsDownloading(false);
    }
  };

  const downloadCurrentQuestion = async () => {
    const el = questionContainersRef.current[current];
    if (!el) return;

    setIsDownloading(true);
    try {
      const drawingCanvas = canvasRefs.current[current];
      if (drawingCanvas) drawingCanvas.style.opacity = "1";

      const canvas = await html2canvas(el, {
        scale: 1.5,
        useCORS: true,
        backgroundColor: "#ffffff",
      });

      const imgData = canvas.toDataURL("image/png");
      const link = document.createElement('a');
      link.download = `${subjName}_Q${current + 1}_Notes.png`;
      link.href = imgData;
      link.click();
    } catch (error) {
      console.error("Image Download Error:", error);
    } finally {
      setIsDownloading(false);
    }
  };

  if (loading || !isInitialLoadComplete) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column' }}>
        <h2>Loading your progress...</h2>
        <p>Syncing with cloud...</p>
      </div>
    );
  }

  if (!quizData) return <h2>Quiz not found for {subjectName} chapter {chapterId}</h2>;
  const { questions, subjectName: subjName, chapterName } = quizData;
  const hasEditsOnPage = drawings[current] || savedExplanations[current];

  const btnBase = { padding: "8px 16px", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" };

  return (
    <div style={{ padding: "20px", paddingBottom: "100px", fontFamily: "Arial", maxWidth: "1100px", margin: "0 auto", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>

      {/* --- GLOBAL TOP HEADER WITH MAIN SAVE BUTTON --- */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>{subjName} - {chapterName}</h2>
        <div style={{ display: "flex", gap: "10px" }}>

          {(isDrawingMode || isHighlightMode) && (
            <button
              onClick={manualSaveToCloud}
              disabled={!hasUnsavedChanges || isSaving}
              style={{
                ...btnBase,
                background: hasUnsavedChanges ? "#ff9800" : "#e0e0e0",
                color: hasUnsavedChanges ? "#fff" : "#888",
                cursor: hasUnsavedChanges ? "pointer" : "default",
                boxShadow: hasUnsavedChanges ? "0 2px 8px rgba(255,152,0,0.4)" : "none",
                transition: "all 0.2s ease"
              }}
            >
              {isSaving ? '⏳ Saving...' : (hasUnsavedChanges ? '💾 Save to Cloud' : '☁️ Saved')}
            </button>
          )}

          <button onClick={() => navigate(`/quizzes/${subjectName}`)} style={{ padding: "8px 16px", ...btnBase }}>Back to Chapters</button>
        </div>
      </div>

      {isSaving && (
        <div style={{
          position: "fixed", top: "20px", right: "20px", zIndex: 10000,
          background: "#fff3cd", color: "#856404", padding: "12px 24px",
          borderRadius: "8px", border: "1px solid #ffeeba",
          boxShadow: "0 4px 15px rgba(0,0,0,0.2)",
          display: "flex", alignItems: "center", gap: "12px",
          fontWeight: "bold", fontSize: "0.95rem"
        }}>
          <span style={{
            display: "inline-block", width: "18px", height: "18px",
            border: "3px solid rgba(133,100,4,0.3)", borderRadius: "50%",
            borderTopColor: "#856404", animation: "spin 1s ease-in-out infinite"
          }} />
          ☁️ Saving to Cloud...
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* --- REVIEW MODE HEADER MOVED TO TOP --- */}
      {isSubmitted && !isRetakeMode && (
        <div style={{ margin: "20px auto 25px", width: "100%", padding: "20px", background: "#e8f5e9", borderRadius: "8px", textAlign: "center", maxWidth: "955px" }}>
          <h3 style={{ color: "#2e7d32", marginBottom: "15px" }}>Review Mode</h3>
          <p style={{ color: "#555", marginBottom: "15px" }}>You can continue adding notes and highlights to any page before downloading.</p>
          <div style={{ display: "flex", justifyContent: "center", gap: "15px", flexWrap: "wrap" }}>
            <button
              onClick={downloadPDF}
              disabled={isDownloading}
              style={{ ...btnBase, background: "#2196f3", color: "white", fontSize: "1.1rem", padding: "12px 24px", position: "relative", zIndex: 200, pointerEvents: "auto", opacity: isDownloading ? 0.7 : 1 }}
            >
              {isDownloading ? "Generating PDF... ⏳" : "Download Study Notes (PDF) 📥"}
            </button>
            <button
              onClick={startFreshRetainNotes}
              style={{ ...btnBase, background: "#8e44ad", color: "white", fontSize: "1.1rem", padding: "12px 24px", position: "relative", zIndex: 200, pointerEvents: "auto", marginLeft: "15px" }}>
              Re-take quiz ✨
            </button>
            <button
              onClick={() => {
                const resetState = { current: 0, retakeAnswers: {}, retakeSubmitted: false };
                setIsRetakeMode(true);
                setRetakeAnswers({});
                setRetakeSubmitted(false);
                setCurrent(0);
                queueUpdate(resetState);
              }}
              style={{ ...btnBase, background: "#ff9800", color: "white", fontSize: "1.1rem", padding: "12px 24px", position: "relative", zIndex: 200, pointerEvents: "auto" }}
            >
              Test Yourself 🔄
            </button>
            <button onClick={clearAnnotations} style={{ ...btnBase, background: "#f44336", color: "white", fontSize: "1.1rem", padding: "12px 24px", position: "relative", zIndex: 200, pointerEvents: "auto" }}>
              Clear Notes 🗑️
            </button>
          </div>
        </div>
      )}

      {/* --- RETAKE RESULTS HEADER MOVED TO TOP --- */}
      {isRetakeMode && retakeSubmitted && (
        <div style={{ margin: "20px auto 25px", width: "100%", padding: "20px", background: "#e3f2fd", borderRadius: "8px", textAlign: "center", maxWidth: "955px" }}>
          <h3 style={{ color: "#1976d2", marginBottom: "15px" }}>Retake Results</h3>
          {(() => {
            let correct = 0, wrong = 0, unattempted = 0;
            questions.forEach((q, index) => {
              if (retakeAnswers[index] === undefined) unattempted++;
              else if (retakeAnswers[index] === q.correct) correct++;
              else wrong++;
            });
            return (
              <div style={{ fontSize: "1.1rem", lineHeight: "1.6" }}>
                <p>Correct: <strong style={{ color: "#4caf50" }}>{correct}</strong></p>
                <p>Wrong: <strong style={{ color: "#f44336" }}>{wrong}</strong></p>
                <p>Unattempted: <strong>{unattempted}</strong></p>
                <h3 style={{ marginTop: "15px" }}>Score: {correct} / {questions.length}</h3>
              </div>
            );
          })()}
          <button onClick={() => { setIsRetakeMode(false); setRetakeSubmitted(false); setRetakeAnswers({}); }} style={{ ...btnBase, background: "#1976d2", color: "white", marginTop: "20px", padding: "10px 20px" }}>
            Exit Retake Mode
          </button>
        </div>
      )}

      {!isRetakeMode && (isSubmitted || showExp[current]) && (() => {
        const canUndo = historyState[current]?.undo > 0;
        const canRedo = historyState[current]?.redo > 0;

        const tb = {
          wrap: {
            display: "flex", flexWrap: "nowrap", gap: "8px", padding: "8px 12px",
            background: "linear-gradient(135deg, #1e1e2e 0%, #2a2a3e 100%)",
            borderRadius: "12px",
            maxWidth: "98vw", alignItems: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
            border: (isDrawingMode || isHighlightMode) ? "1.5px solid #7c6fff" : "1.5px solid rgba(255,255,255,0.1)",
            transition: "border 0.3s ease, box-shadow 0.3s ease",
            ...toolbarStyle
          },
          pill: (active, from, to) => ({
            display: "inline-flex", alignItems: "center", gap: "5px", padding: "6px 14px", border: "none", borderRadius: "999px", cursor: "pointer",
            fontWeight: 700, fontSize: "0.82rem", letterSpacing: "0.01em",
            background: active ? `linear-gradient(135deg, ${from}, ${to})` : "rgba(255,255,255,0.08)",
            color: active ? "#fff" : "#ccc", boxShadow: active ? `0 2px 12px ${from}55` : "none",
            transition: "all 0.2s ease"
          }),
          sep: { width: "1px", height: "24px", background: "rgba(255,255,255,0.15)", margin: "0 2px", flexShrink: 0 },
          card: { display: "flex", gap: "6px", alignItems: "center", background: "rgba(255,255,255,0.06)", borderRadius: "8px", padding: "4px 10px", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer" },
          label: { fontSize: "0.7rem", fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.05em", textTransform: "uppercase" },
          dot: (active, bg) => ({
            width: "22px", height: "22px", borderRadius: "50%", border: active ? "3px solid #fff" : "2px solid rgba(255,255,255,0.2)",
            background: bg, cursor: "pointer", boxShadow: active ? `0 0 8px ${bg}` : "none", transition: "all 0.2s"
          }),
          toolBtn: (active) => ({
            display: "inline-flex", alignItems: "center", gap: "4px", padding: "5px 10px", border: "none", borderRadius: "6px", cursor: "pointer",
            fontWeight: 600, fontSize: "0.78rem", background: active ? "rgba(124,111,255,0.35)" : "rgba(255,255,255,0.07)",
            color: active ? "#c9c4ff" : "#bbb", transition: "all 0.2s"
          }),
          undoBtn: (active) => ({
            display: "inline-flex", alignItems: "center", gap: "4px", padding: "5px 10px", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", cursor: active ? "pointer" : "not-allowed",
            fontWeight: 600, fontSize: "0.78rem", background: "rgba(255,255,255,0.06)", color: "#ccc", transition: "all 0.2s", opacity: active ? 1 : 0.4
          })
        };

        const popoverStyle = {
          position: "absolute",
          top: "calc(100% + 10px)",
          left: "50%",
          transform: "translateX(-50%)",
          background: "linear-gradient(135deg, #1e1e2e 0%, #2a2a3e 100%)",
          padding: "8px",
          borderRadius: "12px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          display: "flex",
          gap: "6px",
          border: "1.5px solid rgba(255,255,255,0.1)",
          zIndex: 10001,
          flexWrap: "nowrap"
        };

        const penColors = [
          { c: '#FF003C', n: 'Neon Red' }, { c: '#00D0FF', n: 'Cyan Blue' }, { c: '#00FF33', n: 'Neon Green' },
          { c: '#FF8800', n: 'Vibrant Orange' }, { c: '#D500F9', n: 'Bright Purple' }, { c: '#FFEA00', n: 'Bright Yellow' },
          { c: '#111111', n: 'Deep Black' }, { c: '#FFFFFF', n: 'Pure White' }
        ];
        const hlColors = [{ c: '#FFF800', n: 'Yellow' }, { c: '#00FF66', n: 'Green' }, { c: '#FF007F', n: 'Pink' }, { c: '#00E5FF', n: 'Blue' }];
        const tools = [
          { v: 'pen', icon: '✏️', label: 'Pen' },
          { v: 'line', icon: '╱', label: 'Line' }, { v: 'rectangle', icon: '▭', label: 'Rect' },
          { v: 'circle', icon: '◯', label: 'Circle' }
        ];

        return (
          <div style={tb.wrap}>
            <button onClick={() => {
              if (isDrawingMode && drawTool !== 'eraser') { setIsDrawingMode(false); setActiveMenu(null); }
              else { setIsDrawingMode(true); setIsHighlightMode(false); if (drawTool === 'eraser') setDrawTool('pen'); setActiveMenu(null); }
            }} style={tb.pill(isDrawingMode && drawTool !== 'eraser', '#7c6fff', '#4a90d9')}>
              ✏️ Pen
            </button>

            <button onClick={() => {
              if (isHighlightMode) { setIsHighlightMode(false); setActiveMenu(null); }
              else { setIsHighlightMode(true); setIsDrawingMode(false); setActiveMenu(null); }
            }} style={tb.pill(isHighlightMode, '#ff9f43', '#ee5a24')}>
              🖍️ Highlighter
            </button>

            <button onClick={() => {
              if (isDrawingMode && drawTool === 'eraser') { setIsDrawingMode(false); setActiveMenu(null); }
              else { setIsDrawingMode(true); setIsHighlightMode(false); setDrawTool('eraser'); setActiveMenu(null); }
            }} style={tb.pill(isDrawingMode && drawTool === 'eraser', '#ff4757', '#c0392b')}>
              🧽 Eraser
            </button>

            <div style={tb.sep} />

            <button
              onClick={() => { canUndo && handleUndo(current); setActiveMenu(null); }}
              style={tb.undoBtn(canUndo)}
              title="Undo Session Action"
              disabled={!canUndo}
            >
              ↩
            </button>
            <button
              onClick={() => { canRedo && handleRedo(current); setActiveMenu(null); }}
              style={tb.undoBtn(canRedo)}
              title="Redo Session Action"
              disabled={!canRedo}
            >
              ↪
            </button>

            {(isDrawingMode || isHighlightMode) && (
              <>
                <div style={tb.sep} />
                <button
                  onClick={() => { manualSaveToCloud(); setActiveMenu(null); }}
                  style={tb.pill(hasUnsavedChanges, '#ff9800', '#e67e22')}
                  disabled={!hasUnsavedChanges || isSaving}
                  title="Save Annotations"
                >
                  {isSaving ? '⏳' : '💾'} {hasUnsavedChanges ? 'Save' : 'Saved'}
                </button>
              </>
            )}

            {isHighlightMode && (
              <>
                <div style={tb.sep} />
                <div style={{ position: 'relative' }}>
                  <button onClick={() => setActiveMenu(activeMenu === 'hColor' ? null : 'hColor')} style={tb.card}>
                    <div style={tb.dot(true, highlightColor)} /> ▼
                  </button>
                  {activeMenu === 'hColor' && (
                    <div style={popoverStyle}>
                      {hlColors.map(({ c, n }) => (
                        <button key={c} title={n} onClick={() => { setHighlightColor(c); setActiveMenu(null); }} style={tb.dot(highlightColor === c, c)} />
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {isDrawingMode && drawTool !== 'eraser' && (
              <>
                <div style={tb.sep} />

                <div style={{ position: 'relative' }}>
                  <button onClick={() => setActiveMenu(activeMenu === 'tool' ? null : 'tool')} style={tb.toolBtn(true)}>
                    {tools.find(t => t.v === drawTool)?.icon} ▼
                  </button>
                  {activeMenu === 'tool' && (
                    <div style={popoverStyle}>
                      {tools.map(({ v, icon, label }) => (
                        <button key={v} title={label} onClick={() => { setDrawTool(v); setActiveMenu(null); }} style={tb.toolBtn(drawTool === v)}>{icon}</button>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ position: 'relative' }}>
                  <button onClick={() => setActiveMenu(activeMenu === 'color' ? null : 'color')} style={tb.card}>
                    <div style={tb.dot(true, penColor)} /> ▼
                  </button>
                  {activeMenu === 'color' && (
                    <div style={popoverStyle}>
                      {penColors.map(({ c, n }) => (
                        <button key={c} title={n} onClick={() => { setPenColor(c); setActiveMenu(null); }} style={tb.dot(penColor === c, c)} />
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ position: 'relative' }}>
                  <button onClick={() => setActiveMenu(activeMenu === 'size' ? null : 'size')} style={tb.card}>
                    <div style={{ width: `${Math.max(4, penWidth / 1.5)}px`, height: `${Math.max(4, penWidth / 1.5)}px`, backgroundColor: penColor, borderRadius: '50%' }} />
                    <span style={{ fontSize: "0.78rem", color: "#ccc", fontWeight: "600", marginLeft: "4px" }}>{penWidth}</span> ▼
                  </button>
                  {activeMenu === 'size' && (
                    <div style={{ ...popoverStyle, padding: "12px", width: "160px", display: "flex", alignItems: "center", gap: "10px" }}>
                      <input type="range" min="1" max="20" value={penWidth}
                        onChange={(e) => setPenWidth(Number(e.target.value))}
                        style={{ flex: 1, accentColor: "#7c6fff", cursor: "pointer" }} />
                      <span style={{ color: "#fff", fontSize: "0.8rem", fontWeight: "bold" }}>{penWidth}</span>
                    </div>
                  )}
                </div>
              </>
            )}

            {isSubmitted && !isRetakeMode && (
              <div style={{ position: 'relative', display: 'flex', gap: '4px', marginLeft: 'auto' }}>
                <button
                  onClick={() => setActiveMenu(activeMenu === 'download' ? null : 'download')}
                  disabled={isDownloading}
                  style={tb.pill(true, '#2196f3', '#1976d2')}
                >
                  {isDownloading ? "⏳..." : "📥 Download"} ▼
                </button>
                {activeMenu === 'download' && (
                  <div style={{ ...popoverStyle, width: '180px', flexDirection: 'column', alignItems: 'stretch' }}>
                    <button
                      onClick={() => { downloadCurrentQuestion(); setActiveMenu(null); }}
                      style={{ ...tb.toolBtn(false), justifyContent: 'flex-start', padding: '10px' }}
                    >
                      🖼️ Current Question (PNG)
                    </button>
                    <button
                      onClick={() => { downloadPDF(); setActiveMenu(null); }}
                      style={{ ...tb.toolBtn(false), justifyContent: 'flex-start', padding: '10px' }}
                    >
                      📄 Full Study Notes (PDF)
                    </button>
                  </div>
                )}
              </div>
            )}

            {!isSubmitted && hasEditsOnPage && (
              <button onClick={() => { clearPage(current); setActiveMenu(null); }}
                style={{ ...tb.pill(false, '#ff4757', '#c0392b'), marginLeft: isSubmitted ? "8px" : "auto", color: "#ffbaba", background: "rgba(255,71,87,0.15)", border: "1px solid rgba(255,71,87,0.4)" }}>
                Clear Page
              </button>
            )}
          </div>
        );
      })()}

      <div style={{ display: "flex", gap: "25px", alignItems: "flex-start", marginTop: "20px", justifyContent: "center" }}>
        <div id="quiz-review-container" style={{ width: "750px", maxWidth: "100%", flexShrink: 0, background: "white", minHeight: "400px", borderRadius: "12px", boxShadow: "0 2px 10px rgba(0,0,0,0.05)", border: "1px solid #eee", padding: "20px", position: "relative", overflow: "visible" }}>
          {questions.map((q, index) => {
            const showAll = isSubmitted && !isRetakeMode;
            if (!showAll && index !== current) return null;

            return (
              <div
                key={index}
                ref={el => questionContainersRef.current[index] = el}
                onPointerDown={(e) => {
                  activePointers.current.add(e.pointerId);

                  if (activePointers.current.size > 1) {
                    abortDrawing(index);
                    return;
                  }

                  if (isDrawingMode && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
                    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { }
                    startDrawing(e, index);
                  }
                }}
                onPointerMove={(e) => {
                  if (activePointers.current.size > 1) {
                    abortDrawing(index);
                    return;
                  }
                  if (isDrawing.current) draw(e, index);
                }}
                onPointerUp={(e) => {
                  activePointers.current.delete(e.pointerId);
                  if (isDrawing.current) {
                    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (err) { }
                    stopDrawing(index, e.clientX, e.clientY);
                  }
                }}
                onPointerLeave={(e) => {
                  if (isDrawing.current && activePointers.current.size <= 1) {
                    stopDrawing(index, e.clientX, e.clientY);
                  }
                }}
                onPointerCancel={(e) => {
                  activePointers.current.delete(e.pointerId);
                  abortDrawing(index);
                }}
                style={{
                  position: "relative", padding: "30px", paddingBottom: showAll ? "70px" : "30px", marginBottom: "0",
                  borderBottom: showAll && index < questions.length - 1 ? "2px dashed #eee" : "none",
                  touchAction: isDrawingMode ? "pinch-zoom" : "auto",
                  userSelect: isDrawingMode ? "none" : "auto",
                  WebkitUserSelect: isDrawingMode ? "none" : "auto",
                  WebkitTouchCallout: "none",
                  textAlign: "left",
                  cursor: isDrawingMode
                    ? ((isRetakeMode ? retakeSubmitted : (isSubmitted || showExp[index])) ? getCustomCursor() : 'default')
                    : 'default'
                }}
              >
                <div style={{
                  display: "flex", alignItems: "flex-start", gap: "8px", marginBottom: "20px",
                  pointerEvents: isDrawingMode ? "none" : "auto", userSelect: isDrawingMode ? "none" : "auto"
                }}>
                  <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                    {index + 1}.
                  </span>
                  <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                    {q.question}
                  </span>
                </div>

                {q.options.map((opt, i) => {
                  let isDisabled = false;
                  let bg = "#f9f9f9";
                  let color = "black";
                  let opacity = 1;

                  if (isRetakeMode) {
                    isDisabled = retakeSubmitted;
                    if (retakeAnswers[index] !== undefined) {
                      if (retakeSubmitted) {
                        bg = i === q.correct ? "#4caf50" : i === retakeAnswers[index] ? "#f44336" : "#f9f9f9";
                        color = (i === q.correct || i === retakeAnswers[index]) ? "white" : "black";
                      } else {
                        bg = i === retakeAnswers[index] ? "#2196f3" : "#f9f9f9";
                        color = i === retakeAnswers[index] ? "white" : "black";
                      }
                    }
                    if (retakeSubmitted && retakeAnswers[index] === undefined) opacity = 0.7;
                  } else {
                    isDisabled = (isSubmitted && !isRetakeMode) || isDrawingMode || showExp[index];
                    if (selectedAnswers[index] !== undefined) {
                      if (isSubmitted || showExp[index]) {
                        bg = i === q.correct ? "#4caf50" : i === selectedAnswers[index] ? "#f44336" : "#f9f9f9";
                        color = (i === q.correct || i === selectedAnswers[index]) ? "white" : "black";
                      } else {
                        bg = i === selectedAnswers[index] ? "#2196f3" : "#f9f9f9";
                        color = i === selectedAnswers[index] ? "white" : "black";
                      }
                    }
                    if (((isSubmitted && !isRetakeMode) || isDrawingMode || showExp[index]) && selectedAnswers[index] === undefined) opacity = 0.7;
                  }

                  return (
                    <button
                      key={i}
                      onClick={() => handleClick(index, i)}
                      disabled={isDisabled}
                      data-mcq-btn="true"
                      data-q-index={index}
                      data-opt-index={i}
                      style={{
                        display: "block", margin: "10px 0", padding: "12px 15px", width: "100%",
                        textAlign: "left", border: "1px solid #ccc", borderRadius: "6px", background: bg, color: color, opacity: opacity,
                        cursor: isDisabled ? "default" : "pointer", position: "relative", zIndex: isDrawingMode ? 1 : 110,
                        pointerEvents: isDrawingMode ? "none" : "auto", fontSize: "1rem"
                      }}
                    >
                      {opt}
                    </button>
                  );
                })}

                {!isRetakeMode && !isSubmitted && selectedAnswers[index] !== undefined && !showExp[index] && (
                  <button
                    onClick={() => handleShowExplanation(index)}
                    style={{
                      marginTop: "15px", padding: "10px 20px", background: "#4caf50", color: "white", border: "none",
                      borderRadius: "6px", cursor: "pointer", fontWeight: "bold", display: "block", width: "fit-content",
                      position: "relative", zIndex: 110
                    }}
                  >
                    Check Answer & Explanation 👁️
                  </button>
                )}

                {!isRetakeMode && (isSubmitted || showExp[index]) && q.explanation && (
                  <div style={{ marginTop: "20px", position: "relative", zIndex: 10, pointerEvents: isDrawingMode ? "none" : "auto", textAlign: "left" }}>
                    <strong>Explanation <span style={{ color: "#666", fontSize: "0.9rem", fontWeight: "normal" }}>{isHighlightMode ? "(Drag to highlight)" : ""}</span>:</strong>
                    <div
                      ref={el => explanationRefs.current[index] = el}
                      onPointerUp={(e) => handleMouseUp(index)}
                      onTouchEnd={() => handleMouseUp(index)}
                      style={{
                        border: "1px solid #ccc", borderRadius: "4px", padding: "15px", marginTop: "10px", background: "#fff8e1",
                        cursor: isHighlightMode ? "text" : "default", userSelect: isHighlightMode ? "text" : "none",
                        WebkitUserSelect: isHighlightMode ? "text" : "none", WebkitTouchCallout: "none", pointerEvents: isDrawingMode ? "none" : "auto",
                        textAlign: "left"
                      }}
                      dangerouslySetInnerHTML={{ __html: savedExplanations[index] ? savedExplanations[index] : `<span>${q.explanation}</span>` }}
                    />
                    {savedExplanations[index] && (
                      <button onClick={() => clearHighlight(index)} data-tap-btn="true" style={{ marginTop: "6px", padding: "4px 8px", fontSize: "0.82rem", cursor: "pointer", pointerEvents: "auto" }}>
                        Clear Highlight
                      </button>
                    )}
                  </div>
                )}
                {!isRetakeMode && (
                  <>
                    <canvas
                      ref={el => canvasRefs.current[index] = el}
                      style={{
                        position: "absolute", top: 0, left: 0, zIndex: 9999,
                        opacity: (isSubmitted || showExp[index]) ? 1 : 0, pointerEvents: "none", touchAction: "none"
                      }}
                    />
                    <canvas
                      ref={el => previewCanvasRefs.current[index] = el}
                      style={{
                        position: "absolute", top: 0, left: 0, zIndex: 10000,
                        opacity: (isSubmitted || showExp[index]) ? 1 : 0, pointerEvents: "none", touchAction: "none"
                      }}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* --- UPDATED PALETTE (5-Column Scrollable Grid) --- */}
        <div style={{
          width: "220px", flexShrink: 0, position: "sticky", top: "20px", background: "#fff",
          borderRadius: "14px", border: "1px solid #eee", padding: "15px",
          boxShadow: "0 4px 15px rgba(0,0,0,0.03)", display: (isSubmitted && !isRetakeMode) ? "none" : "flex", flexDirection: "column",
          maxHeight: "calc(100vh - 40px)" // Prevents the whole palette from overflowing the screen
        }}>

          {/* Scrollable Grid Area */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "6px",
            overflowY: "auto", paddingRight: "4px", paddingBottom: "4px", flexGrow: 1, maxHeight: "320px", alignContent: "start"
          }}>
            {questions.map((_, index) => {
              const isAnswered = isRetakeMode ? retakeAnswers[index] !== undefined : selectedAnswers[index] !== undefined;
              const isCurrent = current === index;

              return (
                <button
                  key={index}
                  onClick={() => handleQuestionChange(index)}
                  style={{
                    width: "100%", aspectRatio: "1", border: "1px solid #ddd", borderRadius: "4px", cursor: "pointer",
                    fontWeight: "700", fontSize: "0.75rem", display: "flex", alignItems: "center", justifyContent: "center", padding: "0",
                    background: isCurrent ? "#7c6fff" : isAnswered ? "#2ed573" : "#f8f9fa",
                    color: (isCurrent || isAnswered) ? "white" : "#555", transition: "all 0.2s ease",
                    boxShadow: isCurrent ? "0 2px 8px rgba(124,111,255,0.4)" : "none", transform: isCurrent ? "scale(1.08)" : "none"
                  }}
                >
                  {index + 1}
                </button>
              );
            })}
          </div>

          {/* Legends */}
          <div style={{ marginTop: "15px", paddingTop: "15px", borderTop: "1px solid #eee", fontSize: "0.75rem", fontWeight: "600", color: "#777", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: "10px", marginBottom: "10px", alignItems: "center" }}>
              <div style={{ width: "12px", height: "12px", background: "#7c6fff", borderRadius: "3px" }} /> <span>Current</span>
            </div>
            <div style={{ display: "flex", gap: "10px", marginBottom: "10px", alignItems: "center" }}>
              <div style={{ width: "12px", height: "12px", background: "#2ed573", borderRadius: "3px" }} /> <span>Answered</span>
            </div>
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <div style={{ width: "12px", height: "12px", background: "#f8f9fa", border: "1px solid #ddd", borderRadius: "3px" }} /> <span>Not Answered</span>
            </div>
          </div>

          {/* --- SUBMIT BUTTON INSIDE THE PALETTE --- */}
          {!isSubmitted && (!isRetakeMode || !retakeSubmitted) && (
            <button
              onClick={() => {
                if (window.confirm("⚠️ Warning: Are you sure you want to submit? You won't be able to change your answers!")) {
                  if (isRetakeMode) {
                    setRetakeSubmitted(true);
                    queueUpdate({ retakeAnswers, retakeSubmitted: true, current: current });
                  } else {
                    submitQuiz();
                  }
                }
              }}
              style={{
                ...btnBase,
                background: "#ff9800",
                color: "white",
                marginTop: "15px",
                width: "100%",
                padding: "10px",
                boxShadow: "0 4px 10px rgba(255,152,0,0.3)",
                flexShrink: 0 // Keeps the submit button firmly at the bottom
              }}
            >
              Submit {isRetakeMode ? "Retake" : "Quiz"}
            </button>
          )}
        </div>
      </div>

      {(!isSubmitted || isRetakeMode) && (
        <div style={{ margin: "20px auto 0", width: "100%", display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center", maxWidth: "955px" }}>
          <button onClick={prevQuestion} disabled={current === 0} style={btnBase}>Previous</button>
          <button onClick={nextQuestion} disabled={current === questions.length - 1} style={btnBase}>Next</button>
        </div>
      )}

    </div>
  );
}

export default Quiz;