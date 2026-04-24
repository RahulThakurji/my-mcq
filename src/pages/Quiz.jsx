import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { loadQuiz } from '../utils/loadQuiz';
import { useAuth } from '../context/AuthContext';
import { doc, setDoc, getDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

function Quiz() {
  const { subjectName, chapterId } = useParams();
  const navigate = useNavigate();
  const { user, login } = useAuth();

  // --- Dynamic Data State ---
  const [quizData, setQuizData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

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
  const [penColor, setPenColor] = useState('#ff0000');
  const [highlightColor, setHighlightColor] = useState('#ffff00');
  const [penWidth, setPenWidth] = useState(2);

  const [drawings, setDrawings] = useState({});

  const canvasRefs = useRef({});
  const undoHistoryRefs = useRef({});
  const redoHistoryRefs = useRef({});
  const questionContainersRef = useRef({});
  const explanationRefs = useRef({});
  const activeCanvasIndex = useRef(null);
  const isDrawing = useRef(false);

  // Snapshots for shapes
  const startX = useRef(0);
  const startY = useRef(0);
  const snapshot = useRef(null);

  // Auto-Snap Feature Refs
  const strokePoints = useRef([]);
  const holdTimeout = useRef(null);
  const preStrokeSnapshot = useRef(null);
  const lastPos = useRef({ x: 0, y: 0 });
  const isSnapped = useRef(false);
  const isHighlightErased = useRef(false);

  // Load the specific quiz data
  useEffect(() => {
    loadQuiz(subjectName, chapterId).then(data => {
      setQuizData(data);
      setLoading(false);
    });
  }, [subjectName, chapterId]);

  // Sync progress from Firestore in real-time
  useEffect(() => {
    if (!user || !subjectName || !chapterId) {
      setIsInitialLoadComplete(true);
      return;
    }

    const docRef = doc(db, 'users', user.uid, 'quizzes', `${subjectName}-${chapterId}`);
    const unsubscribe = onSnapshot(docRef, { includeMetadataChanges: true }, (docSnap) => {
      if (docSnap.exists() && !docSnap.metadata.hasPendingWrites) {
        const data = docSnap.data();
        if (data.drawings !== undefined) setDrawings(data.drawings);
        if (data.savedExplanations !== undefined) setSavedExplanations(data.savedExplanations);
        if (data.notes !== undefined) setNotes(data.notes);
        if (data.selectedAnswers !== undefined) setSelectedAnswers(data.selectedAnswers);
        if (data.showExp !== undefined) setShowExp(data.showExp);
        if (data.current !== undefined) setCurrent(data.current);

        if (data.isSubmitted !== undefined) {
          setIsSubmitted(data.isSubmitted);
        }
      } else if (!docSnap.exists()) {
        // No document exists: Hydrate state with defaults and create initial document
        setCurrent(0);
        setDrawings({});
        setSavedExplanations({});
        setSelectedAnswers({});
        setShowExp({});
        setIsSubmitted(false);

        setDoc(docRef, {
          current: 0,
          drawings: {},
          savedExplanations: {},
          selectedAnswers: {},
          showExp: {},
          isSubmitted: false
        }).catch(err => console.error("Error creating initial document:", err));
      }
      setIsInitialLoadComplete(true);
    }, (error) => {
      console.error("Error listening to progress:", error);
      setIsInitialLoadComplete(true);
    });

    return () => unsubscribe();
  }, [user, subjectName, chapterId]);

  // Sync to Cloud helper
  const syncToCloud = async (updates) => {
    if (!user) {
      if (!window.hasAlertedForLoginGeneral) {
        alert("You are not logged in! Your progress will not be saved to the cloud.");
        window.hasAlertedForLoginGeneral = true;
      }
      return;
    }
    const docRef = doc(db, 'users', user.uid, 'quizzes', `${subjectName}-${chapterId}`);
    try {
      await updateDoc(docRef, updates);
    } catch (error) {
      if (error.code === 'not-found' || error.code === 'firestore/not-found' || String(error).includes('not-found')) {
        try {
          await setDoc(docRef, updates);
        } catch (setDocError) {
          console.error("Error creating document:", setDocError);
          alert(`Firestore Error (Create): ${setDocError.message}. Please check your Firebase rules!`);
        }
      } else {
        console.error("Error syncing progress:", error);
        alert(`Firestore Error (Update): ${error.message}. Please check your Firebase rules!`);
      }
    }
  };

  // Set up Canvas size and RESTORE saved drawings
  useEffect(() => {
    if (!quizData) return;

    quizData.questions.forEach((_, index) => {
      // If we are not in Full Review mode, only process the 'current' canvas
      if (!isSubmitted && index !== current) return;

      const canvas = canvasRefs.current[index];
      const container = questionContainersRef.current[index];

      if (canvas && container) {
        const needsResize = canvas.width !== container.offsetWidth || canvas.height !== container.offsetHeight;
        if (needsResize || (drawings[index] && canvas.dataset.loaded !== drawings[index])) {
          if (needsResize) {
            canvas.width = container.offsetWidth;
            canvas.height = container.offsetHeight;
          }
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (drawings[index]) {
            const img = new Image();
            img.src = drawings[index];
            img.onload = () => ctx.drawImage(img, 0, 0);
            canvas.dataset.loaded = drawings[index];
          } else {
            canvas.dataset.loaded = "empty";
          }
        }
      }
    });
  }, [current, isDrawingMode, quizData, isSubmitted, isInitialLoadComplete, drawings, showExp]);

  // --- Core Navigation ---
  const handleQuestionChange = (newIndex) => {
    setCurrent(newIndex);
    if (!isRetakeMode) syncToCloud({ current: newIndex });
  };

  const handleShowExplanation = (index) => {
    setShowExp(prev => ({ ...prev, [index]: true }));
    syncToCloud({ showExp: { ...showExp, [index]: true }, current: current });
  };

  const nextQuestion = () => { if (current < questions.length - 1) handleQuestionChange(current + 1); };
  const prevQuestion = () => { if (current > 0) handleQuestionChange(current - 1); };

  const submitQuiz = () => {
    let newDrawings = drawings;
    setIsSubmitted(true);
    syncToCloud({ drawings: newDrawings, isSubmitted: true });
  };

  const handleClick = (qIdx, optIdx) => {
    if (isRetakeMode) {
      if (retakeSubmitted) return;
      setRetakeAnswers(prev => {
        let newAnswers;
        if (prev[qIdx] === optIdx) {
          newAnswers = { ...prev };
          delete newAnswers[qIdx];
        } else {
          newAnswers = { ...prev, [qIdx]: optIdx };
        }
        // REMOVED syncToCloud here to prevent jumping during retake
        return newAnswers;
      });
      return;
    }

    if (isSubmitted || isDrawingMode || showExp[qIdx]) return;

    setSelectedAnswers(prevAnswers => {
      const newSelectedAnswers = { ...prevAnswers, [qIdx]: optIdx };
      syncToCloud({ selectedAnswers: newSelectedAnswers, current: current });
      return newSelectedAnswers;
    });
  };

  // --- Smart Shape Recognition Engine ---
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

  // --- Canvas Drawing Logic ---
  const startDrawing = (e, index) => {
    const { nativeEvent } = e;
    if (!isDrawingMode) return;
    if (!user && !window.hasAlertedForLoginScratchpad) {
      alert("Please log in with Google to save your notes permanently. Your current drawings will only be saved temporarily.");
      window.hasAlertedForLoginScratchpad = true;
    }

    // Lock drawing behind explanation reveal
    activeCanvasIndex.current = index;
    const { clientX, clientY } = nativeEvent;
    lastPos.current = { x: clientX, y: clientY };
    isDrawing.current = true; // Always mark as 'interacting' for tap detection

    // Lock actual drawing logic behind explanation reveal or submission
    const isDrawingAllowed = isRetakeMode ? retakeSubmitted : (isSubmitted || showExp[index]);
    if (!isDrawingAllowed) return;

    const canvas = canvasRefs.current[index];
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const offsetX = clientX - rect.left;
    const offsetY = clientY - rect.top;

    const ctx = canvas.getContext('2d');

    isDrawing.current = true;
    isSnapped.current = false;
    startX.current = offsetX;
    startY.current = offsetY;

    const state = ctx.getImageData(0, 0, canvas.width, canvas.height);
    preStrokeSnapshot.current = state;
    snapshot.current = state;

    if (!undoHistoryRefs.current[index]) undoHistoryRefs.current[index] = [];
    undoHistoryRefs.current[index].push(state);
    if (undoHistoryRefs.current[index].length > 20) undoHistoryRefs.current[index].shift();

    // Clear redo stack when a new stroke begins
    redoHistoryRefs.current[index] = [];

    strokePoints.current = [{ x: offsetX, y: offsetY }];

    ctx.beginPath();
    ctx.moveTo(offsetX, offsetY);
  };

  const draw = (e, index) => {
    const { nativeEvent } = e;
    if (!isDrawing.current || !isDrawingMode || activeCanvasIndex.current !== index) return;
    const canvas = canvasRefs.current[index];
    const ctx = canvas?.getContext('2d');
    if (!ctx || !isDrawing.current) return;

    const rect = canvas.getBoundingClientRect();
    const offsetX = nativeEvent.clientX - rect.left;
    const offsetY = nativeEvent.clientY - rect.top;

    if (drawTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = 25;
      ctx.lineTo(offsetX, offsetY);
      ctx.stroke();

      // Erase text highlights underneath the canvas
      const elementsUnderCursor = document.elementsFromPoint(nativeEvent.clientX, nativeEvent.clientY);
      const highlightedSpan = elementsUnderCursor.find(el => el.tagName === 'SPAN' && el.style.backgroundColor);
      if (highlightedSpan) {
        const expRef = explanationRefs.current[index];
        if (expRef && expRef.contains(highlightedSpan)) {
          const parent = highlightedSpan.parentNode;
          while (highlightedSpan.firstChild) {
            parent.insertBefore(highlightedSpan.firstChild, highlightedSpan);
          }
          parent.removeChild(highlightedSpan);
          isHighlightErased.current = true;
        }
      }

    } else if (drawTool === 'canvas-highlighter') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = penColor;
      ctx.lineWidth = Math.max(15, penWidth * 3);
      ctx.lineTo(offsetX, offsetY);
      ctx.stroke();

    } else if (drawTool === 'pen') {
      if (isSnapped.current) return;

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = penColor;
      ctx.lineWidth = penWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      strokePoints.current.push({ x: offsetX, y: offsetY });
      const pts = strokePoints.current;

      if (pts.length >= 3) {
        // Redraw from last confirmed segment using quadratic bezier for smooth curves
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

    // Tap detection for buttons
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
    const ctx = canvas?.getContext('2d');
    if (ctx) ctx.closePath();
    isDrawing.current = false;

    if (canvas) {
      const newDrawUrl = canvas.toDataURL();
      setDrawings(prev => {
        const newDrawings = { ...prev, [index]: newDrawUrl };
        if (!isHighlightErased.current) syncToCloud({ drawings: newDrawings });
        return newDrawings;
      });
      canvas.dataset.loaded = newDrawUrl;
    }

    if (isHighlightErased.current) {
      const expRef = explanationRefs.current[index];
      if (expRef) {
        setSavedExplanations(prev => {
          const newExplanations = { ...prev, [index]: expRef.innerHTML };

          // Sync both drawing and the newly erased explanation state at the same time
          setDrawings(prevDrawings => {
            syncToCloud({ drawings: prevDrawings, savedExplanations: newExplanations });
            return prevDrawings;
          });

          return newExplanations;
        });
      }
      isHighlightErased.current = false;
    }

    activeCanvasIndex.current = null;
  };

  const handleUndo = (index) => {
    if (!undoHistoryRefs.current[index] || undoHistoryRefs.current[index].length === 0) return;

    const canvas = canvasRefs.current[index];
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Save current state to redo stack before undoing
    if (!redoHistoryRefs.current[index]) redoHistoryRefs.current[index] = [];
    redoHistoryRefs.current[index].push(ctx.getImageData(0, 0, canvas.width, canvas.height));

    const previousState = undoHistoryRefs.current[index].pop();
    ctx.putImageData(previousState, 0, 0);

    const newDrawUrl = canvas.toDataURL();
    setDrawings(prev => {
      const newDrawings = { ...prev, [index]: newDrawUrl };
      if (!isRetakeMode) syncToCloud({ drawings: newDrawings });
      return newDrawings;
    });
    canvas.dataset.loaded = newDrawUrl;
  };

  const handleRedo = (index) => {
    if (!redoHistoryRefs.current[index] || redoHistoryRefs.current[index].length === 0) return;

    const canvas = canvasRefs.current[index];
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Save current state back to undo stack
    if (!undoHistoryRefs.current[index]) undoHistoryRefs.current[index] = [];
    undoHistoryRefs.current[index].push(ctx.getImageData(0, 0, canvas.width, canvas.height));

    const nextState = redoHistoryRefs.current[index].pop();
    ctx.putImageData(nextState, 0, 0);

    const newDrawUrl = canvas.toDataURL();
    setDrawings(prev => {
      const newDrawings = { ...prev, [index]: newDrawUrl };
      if (!isRetakeMode) syncToCloud({ drawings: newDrawings });
      return newDrawings;
    });
    canvas.dataset.loaded = newDrawUrl;
  };

  // --- Clearing Logic ---
  const clearPage = (index) => {
    const canvas = canvasRefs.current[index];
    if (canvas) {
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      canvas.dataset.loaded = "empty";
    }

    const expRef = explanationRefs.current[index];
    if (expRef) {
      expRef.innerHTML = questions[index].explanation;
    }

    setDrawings(prev => {
      const newDrawings = { ...prev };
      delete newDrawings[index];

      setSavedExplanations(prevExp => {
        const newExplanations = { ...prevExp };
        delete newExplanations[index];

        syncToCloud({ drawings: newDrawings, savedExplanations: newExplanations });
        return newExplanations;
      });

      return newDrawings;
    });
  };

  const clearAnnotations = () => {
    if (window.confirm("Are you sure you want to clear ALL drawings and highlights from every page?")) {
      setDrawings({});
      setSavedExplanations({});
      setSelectedAnswers({});
      setShowExp({});
      setIsSubmitted(false);
      setCurrent(0);

      questions.forEach((_, index) => {
        const canvas = canvasRefs.current[index];
        if (canvas) {
          canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
          canvas.dataset.loaded = "empty";
        }
        const expRef = explanationRefs.current[index];
        if (expRef) {
          expRef.innerHTML = questions[index].explanation;
        }
      });
      syncToCloud({ drawings: {}, savedExplanations: {}, selectedAnswers: {}, showExp: {}, isSubmitted: false, current: 0 });
    }
  };

  // --- Text Highlight Logic ---
  const handleMouseUp = (index) => {
    if (!isSubmitted && !showExp[index]) return; // Lock highlighting behind explanation
    if (isDrawingMode || !isHighlightMode) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (range.toString().length === 0) return;

    if (!user && !window.hasAlertedForLoginHighlight) {
      alert("Please log in with Google to save your highlights permanently. Your current highlights will only be saved temporarily.");
      window.hasAlertedForLoginHighlight = true;
    }

    try {
      const span = document.createElement("span");
      span.style.backgroundColor = highlightColor;
      range.surroundContents(span);  // Fixed typo: surroundContents
      selection.removeAllRanges();

      const expRef = explanationRefs.current[index];
      if (!expRef) return;

      setSavedExplanations(prev => {
        const newExplanations = { ...prev, [index]: expRef.innerHTML };
        syncToCloud({ savedExplanations: newExplanations });
        return newExplanations;
      });
    } catch (err) {
      console.log(err);
    }
  };

  const clearHighlight = (index) => {
    setSavedExplanations(prev => {
      const newExplanations = { ...prev };
      delete newExplanations[index];
      syncToCloud({ savedExplanations: newExplanations });
      return newExplanations;
    });

    const expRef = explanationRefs.current[index];
    if (expRef) {
      expRef.innerHTML = questions[index].explanation;
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

  const calculateScore = () => {
    let score = 0;
    questions.forEach((q, index) => {
      if (selectedAnswers[index] === q.correct) score++;
    });
    return score;
  };

  // --- PDF Logic ---
  const downloadPDF = async () => {
    const element = document.getElementById("pdf-container");
    const canvas = await html2canvas(element, { scale: 2 });
    const imgData = canvas.toDataURL("image/png");

    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();

    const margin = 10;
    const imgWidth = pdfWidth - (margin * 2);
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = margin;

    pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
    heightLeft -= (pdfHeight - (margin * 2));

    while (heightLeft >= 0) {
      position = heightLeft - imgHeight + margin;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
      heightLeft -= (pdfHeight - (margin * 2));
    }

    pdf.save(`${subjName}-${chapterName}-Notes.pdf`);
  };

  // UI Styles
  const btnBase = { padding: "8px 16px", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" };
  const colorBtn = (isActive) => ({ width: "24px", height: "24px", borderRadius: "50%", border: isActive ? "3px solid black" : "1px solid #ccc", cursor: "pointer" });
  const toolFrameStyle = { display: "flex", gap: "8px", alignItems: "center", background: "#fff", padding: "6px 12px", border: "1px solid #ccc", borderRadius: "6px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" };

  return (
    <div style={{ padding: "20px", paddingBottom: "100px", fontFamily: "Arial", maxWidth: "1100px", margin: "0 auto", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>{subjName} - {chapterName}</h2>
        <div style={{ display: "flex", gap: "10px" }}>
          <button onClick={() => navigate(`/quizzes/${subjectName}`)} style={{ padding: "8px 16px", ...btnBase }}>Back to Chapters</button>
        </div>
      </div>

      {/* ─── Modern Toolbar ─── */}
      {!isRetakeMode && (isSubmitted || showExp[current]) && (() => {
        const tb = {
          wrap: {
            display: "flex", flexWrap: "wrap", gap: "8px", padding: "8px 12px",
            background: "linear-gradient(135deg, #1e1e2e 0%, #2a2a3e 100%)",
            borderRadius: "12px",
            position: "fixed",
            bottom: "15px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            width: "max-content",
            maxWidth: "98vw",
            alignItems: "center",
            boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
            border: (isDrawingMode || isHighlightMode) ? "1.5px solid #7c6fff" : "1.5px solid rgba(255,255,255,0.1)",
            transition: "all 0.3s ease"
          },
          pill: (active, from, to) => ({
            display: "inline-flex", alignItems: "center", gap: "5px",
            padding: "6px 14px", border: "none", borderRadius: "999px", cursor: "pointer",
            fontWeight: 700, fontSize: "0.82rem", letterSpacing: "0.01em",
            background: active ? `linear-gradient(135deg, ${from}, ${to})` : "rgba(255,255,255,0.08)",
            color: active ? "#fff" : "#ccc",
            boxShadow: active ? `0 2px 12px ${from}55` : "none",
            transition: "all 0.2s ease"
          }),
          sep: { width: "1px", height: "24px", background: "rgba(255,255,255,0.15)", margin: "0 2px" },
          card: {
            display: "flex", gap: "6px", alignItems: "center",
            background: "rgba(255,255,255,0.06)", borderRadius: "8px",
            padding: "4px 10px", border: "1px solid rgba(255,255,255,0.1)"
          },
          label: { fontSize: "0.7rem", fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.05em", textTransform: "uppercase" },
          dot: (active, bg) => ({
            width: "22px", height: "22px", borderRadius: "50%", border: active ? "3px solid #fff" : "2px solid rgba(255,255,255,0.2)",
            background: bg, cursor: "pointer", boxShadow: active ? `0 0 8px ${bg}` : "none",
            transition: "all 0.2s"
          }),
          toolBtn: (active) => ({
            display: "inline-flex", alignItems: "center", gap: "4px",
            padding: "5px 10px", border: "none", borderRadius: "6px", cursor: "pointer",
            fontWeight: 600, fontSize: "0.78rem",
            background: active ? "rgba(124,111,255,0.35)" : "rgba(255,255,255,0.07)",
            color: active ? "#c9c4ff" : "#bbb",
            transition: "all 0.2s"
          }),
          undoBtn: {
            display: "inline-flex", alignItems: "center", gap: "4px",
            padding: "5px 10px", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", cursor: "pointer",
            fontWeight: 600, fontSize: "0.78rem", background: "rgba(255,255,255,0.06)", color: "#ccc"
          }
        };

        const penColors = [
          { c: '#ff4757', n: 'Red' }, { c: '#1e90ff', n: 'Blue' }, { c: '#2ed573', n: 'Green' },
          { c: '#ffa502', n: 'Orange' }, { c: '#a55eea', n: 'Purple' }, { c: '#ffffff', n: 'White' }, { c: '#2f3542', n: 'Black' }
        ];
        const hlColors = [
          { c: '#ffec3d', n: 'Yellow' }, { c: '#69f0ae', n: 'Green' }, { c: '#ff80ab', n: 'Pink' }, { c: '#40c4ff', n: 'Blue' }
        ];
        const tools = [
          { v: 'pen', icon: '✏️', label: 'Pen' }, { v: 'canvas-highlighter', icon: '🖊️', label: 'Marker' },
          { v: 'line', icon: '╱', label: 'Line' }, { v: 'rectangle', icon: '▭', label: 'Rect' },
          { v: 'circle', icon: '◯', label: 'Circle' }, { v: 'eraser', icon: '🧽', label: 'Eraser' }
        ];

        return (
          <div style={tb.wrap}>
            {/* Pen Toggle */}
            <button onClick={() => { setIsDrawingMode(!isDrawingMode); setIsHighlightMode(false); }}
              style={tb.pill(isDrawingMode, '#7c6fff', '#4a90d9')}>
              ✏️ {isDrawingMode ? 'Close Pen' : 'Pen'}
            </button>

            {/* Highlighter Toggle */}
            <button onClick={() => { setIsHighlightMode(!isHighlightMode); setIsDrawingMode(false); }}
              style={tb.pill(isHighlightMode, '#ff9f43', '#ee5a24')}>
              🖍️ {isHighlightMode ? 'Close' : 'Highlighter'}
            </button>

            {/* Highlighter Colors */}
            {isHighlightMode && (
              <>
                <div style={tb.sep} />
                <div style={tb.card}>
                  <span style={tb.label}>Color</span>
                  {hlColors.map(({ c, n }) => (
                    <button key={c} title={n} onClick={() => setHighlightColor(c)} style={tb.dot(highlightColor === c, c)} />
                  ))}
                </div>
              </>
            )}

            {/* Pen Sub-toolbar */}
            {isDrawingMode && (
              <>
                <div style={tb.sep} />
                {/* Tool Switcher */}
                <div style={tb.card}>
                  {tools.map(({ v, icon, label }) => (
                    <button key={v} title={label} onClick={() => setDrawTool(v)} style={tb.toolBtn(drawTool === v)}>
                      {icon} {label}
                    </button>
                  ))}
                </div>

                {/* Undo / Redo */}
                <button onClick={() => handleUndo(current)} style={tb.undoBtn} title="Undo Last Stroke">↩ Undo</button>
                <button onClick={() => handleRedo(current)} style={tb.undoBtn} title="Redo">↪ Redo</button>

                {/* Ink Colors (hidden for eraser) */}
                {drawTool !== 'eraser' && (
                  <>
                    <div style={tb.card}>
                      <span style={tb.label}>Ink</span>
                      {penColors.map(({ c, n }) => (
                        <button key={c} title={n} onClick={() => setPenColor(c)} style={tb.dot(penColor === c, c)} />
                      ))}
                    </div>

                    {/* Size Slider */}
                    <div style={{ ...tb.card, gap: "10px", minWidth: "150px" }}>
                      <span style={tb.label}>Size</span>
                      <input type="range" min="1" max="20" value={penWidth}
                        onChange={(e) => setPenWidth(Number(e.target.value))}
                        style={{ flex: 1, accentColor: "#7c6fff", cursor: "pointer" }} />
                      <span style={{ color: "#aaa", fontSize: "0.78rem", minWidth: "20px" }}>{penWidth}</span>
                    </div>
                  </>
                )}
              </>
            )}

            {/* Erase Page Annotations */}
            {!isSubmitted && hasEditsOnPage && (
              <button onClick={() => clearPage(current)}
                style={{ ...tb.pill(false, '#ff4757', '#c0392b'), marginLeft: "auto", color: "#ffbaba", background: "rgba(255,71,87,0.15)", border: "1px solid rgba(255,71,87,0.4)" }}>
                🧽 Erase Page
              </button>
            )}
          </div>
        );
      })()}


      {/* Main Content Area with Sidebar */}
      <div style={{ display: "flex", gap: "25px", alignItems: "flex-start", marginTop: "20px" }}>

        {/* Quiz Area */}
        <div style={{ flex: 1, background: "white", minHeight: "400px", borderRadius: "12px", boxShadow: "0 2px 10px rgba(0,0,0,0.05)", border: "1px solid #eee", padding: "0", position: "relative", overflow: "visible" }}>
          {questions.map((q, index) => {
            const showAll = isSubmitted && !isRetakeMode;
            if (!showAll && index !== current) return null;

            return (
              <div
                key={index}
                ref={el => questionContainersRef.current[index] = el}
                onPointerDown={(e) => {
                  if (isDrawingMode && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
                    // Always capture to handle tap-to-select even if drawing is locked
                    e.currentTarget.setPointerCapture(e.pointerId);
                    startDrawing(e, index);
                  }
                }}
                onPointerMove={(e) => { if (isDrawing.current) draw(e, index); }}
                onPointerUp={(e) => {
                  if (isDrawing.current) {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                    stopDrawing(index, e.clientX, e.clientY);
                  }
                }}
                onPointerOut={(e) => { if (isDrawing.current) stopDrawing(index); }}
                onPointerCancel={(e) => { if (isDrawing.current) stopDrawing(index); }}
                style={{
                  position: "relative", padding: "30px", paddingBottom: showAll ? "70px" : "30px", marginBottom: "0",
                  borderBottom: showAll && index < questions.length - 1 ? "2px dashed #eee" : "none",
                  touchAction: isDrawingMode ? "none" : "auto",
                  userSelect: isDrawingMode ? "none" : "auto",
                  WebkitUserSelect: isDrawingMode ? "none" : "auto",
                  WebkitTouchCallout: "none",
                  cursor: isDrawingMode
                    ? ((isRetakeMode ? retakeSubmitted : (isSubmitted || showExp[index]))
                      ? (drawTool === 'eraser' ? 'cell' : 'crosshair')
                      : 'default')
                    : 'default'
                }}
              >
                <h3 style={{ pointerEvents: isDrawingMode ? "none" : "auto" }}>Question {index + 1} / {questions.length}</h3>
                <p style={{ fontSize: '1.2rem', fontWeight: 'bold', userSelect: isDrawingMode ? "none" : "auto", pointerEvents: isDrawingMode ? "none" : "auto" }}>
                  {q.question}
                </p>

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
                      display: "block", margin: "10px 0", padding: "10px", width: "100%", maxWidth: "500px",
                      textAlign: "left", border: "1px solid #ccc", borderRadius: "4px",
                      background: bg,
                      color: color,
                      opacity: opacity,
                      cursor: isDisabled ? "default" : "pointer",
                      position: "relative",
                      zIndex: isDrawingMode ? 1 : 110,
                      pointerEvents: isDrawingMode ? "none" : "auto"
                    }}
                  >
                    {opt}
                  </button>
                );
              })}

                {/* Show Check Answer button for both modes if selected but not revealed */}
                {!isSubmitted && ((!isRetakeMode && selectedAnswers[index] !== undefined) || (isRetakeMode && retakeAnswers[index] !== undefined)) && !showExp[index] && (
                  <button 
                    onClick={() => handleShowExplanation(index)}
                    style={{
                      marginTop: "15px", padding: "10px 20px", background: "#4caf50", color: "white", 
                      border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "bold",
                      display: "block", width: "fit-content", position: "relative", zIndex: 110
                    }}
                  >
                    Check Answer & Explanation 👁️
                  </button>
                )}

                {(isSubmitted || showExp[index]) && q.explanation && (
                  <div style={{ marginTop: "20px", position: "relative", zIndex: 10, pointerEvents: isDrawingMode ? "none" : "auto" }}>

                    {/* Original Explanation with Highlighter support */}
                    <strong>Explanation <span style={{ color: "#666", fontSize: "0.9rem", fontWeight: "normal" }}>{isHighlightMode ? "(Drag to highlight)" : ""}</span>:</strong>
                    <div
                      ref={el => explanationRefs.current[index] = el}
                      onPointerUp={(e) => handleMouseUp(index)}
                      onTouchEnd={() => handleMouseUp(index)}
                      style={{
                        border: "1px solid #ccc", borderRadius: "4px", padding: "15px", marginTop: "5px", background: "#fff8e1",
                        cursor: isHighlightMode ? "text" : "default",
                        userSelect: isHighlightMode ? "text" : "none",
                        WebkitUserSelect: isHighlightMode ? "text" : "none",
                        WebkitTouchCallout: "none",
                        pointerEvents: isDrawingMode ? "none" : "auto"
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
                  <canvas
                    ref={el => canvasRefs.current[index] = el}
                    style={{
                      position: "absolute", top: 0, left: 0, zIndex: 9999,
                      opacity: 1,
                      pointerEvents: "none",
                      touchAction: "none"
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Sidebar Question Palette */}
        <div style={{
          width: "200px", position: "sticky", top: "20px", background: "#fff",
          borderRadius: "14px", border: "1px solid #eee", padding: "15px",
          boxShadow: "0 4px 15px rgba(0,0,0,0.03)", display: (isSubmitted && !isRetakeMode) ? "none" : "block"
        }}>
          <h3 style={{ fontSize: "0.95rem", marginBottom: "12px", color: "#333", borderBottom: "1px solid #eee", paddingBottom: "8px", display: "flex", justifyContent: "space-between" }}>
            Palette <span>{questions.length} Qs</span>
          </h3>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
            {questions.map((_, index) => {
              const isAnswered = isRetakeMode ? retakeAnswers[index] !== undefined : selectedAnswers[index] !== undefined;
              const isCurrent = current === index;

              return (
                <button
                  key={index}
                  onClick={() => handleQuestionChange(index)}
                  style={{
                    width: "100%", aspectRatio: "1", border: "1px solid #ddd", borderRadius: "6px", cursor: "pointer",
                    fontWeight: "800", fontSize: "0.72rem",
                    background: isCurrent ? "#7c6fff" : isAnswered ? "#2ed573" : "#f8f9fa",
                    color: (isCurrent || isAnswered) ? "white" : "#555",
                    transition: "all 0.2s ease",
                    boxShadow: isCurrent ? "0 2px 10px rgba(124,111,255,0.4)" : "none",
                    transform: isCurrent ? "scale(1.08)" : "none"
                  }}
                >
                  {index + 1}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: "25px", paddingTop: "15px", borderTop: "1px solid #eee", fontSize: "0.75rem", fontWeight: "600", color: "#777" }}>
            <div style={{ display: "flex", gap: "10px", marginBottom: "10px", alignItems: "center" }}>
              <div style={{ width: "14px", height: "14px", background: "#7c6fff", borderRadius: "4px" }} /> <span>Current Question</span>
            </div>
            <div style={{ display: "flex", gap: "10px", marginBottom: "10px", alignItems: "center" }}>
              <div style={{ width: "14px", height: "14px", background: "#2ed573", borderRadius: "4px" }} /> <span>Answered</span>
            </div>
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <div style={{ width: "14px", height: "14px", background: "#f8f9fa", border: "1px solid #ddd", borderRadius: "4px" }} /> <span>Not Answered</span>
            </div>
          </div>
        </div>
      </div>


      {(!isSubmitted || isRetakeMode) && (
        <div style={{ marginTop: "20px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button onClick={prevQuestion} disabled={current === 0} style={btnBase}>Previous</button>
          <button onClick={nextQuestion} disabled={current === questions.length - 1} style={btnBase}>Next</button>

          {current === questions.length - 1 && (!isRetakeMode || !retakeSubmitted) && (
            <button 
              onClick={() => {
                if (isRetakeMode) {
                  setRetakeSubmitted(true);
                  syncToCloud({ retakeAnswers, retakeSubmitted: true, current: current });
                } else {
                  submitQuiz();
                }
              }} 
              style={{ ...btnBase, background: "#ff9800", color: "white", marginLeft: "auto" }}
            >
              Submit {isRetakeMode ? "Retake" : "Quiz"}
            </button>
          )}
        </div>
      )}

      {/* RETAKE SUBMIT ACTIONS */}
      {isRetakeMode && retakeSubmitted && (
        <div style={{ marginTop: "30px", padding: "20px", background: "#e3f2fd", borderRadius: "8px", textAlign: "center" }}>
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

      {/* AFTER SUBMIT ACTIONS */}
      {isSubmitted && !isRetakeMode && (
        <div style={{ marginTop: "30px", padding: "20px", background: "#e8f5e9", borderRadius: "8px", textAlign: "center" }}>
          <h3 style={{ color: "#2e7d32", marginBottom: "15px" }}>Review Mode</h3>
          <p style={{ color: "#555", marginBottom: "15px" }}>You can continue adding notes and highlights to any page before downloading.</p>
          <div style={{ display: "flex", justifyContent: "center", gap: "15px", flexWrap: "wrap" }}>
            <button onClick={downloadPDF} style={{ ...btnBase, background: "#2196f3", color: "white", fontSize: "1.1rem", padding: "12px 24px", position: "relative", zIndex: 200, pointerEvents: "auto" }}>
              Download Study Notes (PDF) 📥
            </button>
            <button 
              onClick={() => { 
                const resetState = { current: 0, retakeAnswers: {}, retakeSubmitted: false, showExp: {} };
                setIsRetakeMode(true); 
                setRetakeAnswers({}); 
                setRetakeSubmitted(false); 
                setShowExp({});
                setCurrent(0); 
                syncToCloud(resetState);
              }} 
              style={{ ...btnBase, background: "#ff9800", color: "white", fontSize: "1.1rem", padding: "12px 24px", position: "relative", zIndex: 200, pointerEvents: "auto" }}
            >
              Re-take Quiz 🔄
            </button>
            <button onClick={clearAnnotations} style={{ ...btnBase, background: "#f44336", color: "white", fontSize: "1.1rem", padding: "12px 24px", position: "relative", zIndex: 200, pointerEvents: "auto" }}>
              Clear All (Fresh Start) 🗑️
            </button>

          </div>
        </div>
      )}

      {/* HIDDEN PDF DATA CONTAINER */}
      <div id="pdf-container" style={{ position: "absolute", left: "-9999px", top: "-9999px", width: "794px", padding: "40px", background: "white", color: "black", fontFamily: "Arial", boxSizing: "border-box" }}>
        <h2>{subjName} - {chapterName} (Review)</h2>
        <hr />
        {questions.map((q, index) => (
          <div key={index} style={{ position: "relative", marginBottom: "30px", paddingBottom: "20px" }}>

            {drawings[index] && (
              <img
                src={drawings[index]}
                alt="notes"
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", zIndex: 5, pointerEvents: "none" }}
              />
            )}

            <div style={{ position: "relative", zIndex: 1 }}>
              <h3 style={{ marginBottom: "10px", maxWidth: "700px" }}>Q{index + 1}: {q.question}</h3>
              {q.options.map((opt, i) => (
                <p key={i} style={{ margin: "5px 0", padding: "5px", background: i === q.correct ? "#c8e6c9" : "transparent", fontWeight: i === q.correct ? "bold" : "normal", maxWidth: "600px" }}>
                  {i === q.correct ? "✔ " : "○ "} {opt}
                </p>
              ))}
              <div style={{ marginTop: "10px", padding: "10px", borderLeft: "4px solid #ffeb3b", background: "#fdfbf7", maxWidth: "700px" }}>
                <strong>Explanation: </strong>
                <span dangerouslySetInnerHTML={{ __html: savedExplanations[index] || `<span>${q.explanation}</span>` }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Quiz;