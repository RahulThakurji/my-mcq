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
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
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
      } else {
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
  }, [current, isDrawingMode, quizData, isSubmitted, isInitialLoadComplete, drawings]);

  // --- Core Navigation ---
  const handleQuestionChange = (newIndex) => {
    setCurrent(newIndex);
    if (!isRetakeMode) syncToCloud({ current: newIndex });
  };

  const nextQuestion = () => { if (current < questions.length - 1) handleQuestionChange(current + 1); };
  const prevQuestion = () => { if (current > 0) handleQuestionChange(current - 1); };

  const submitQuiz = () => {
    let newDrawings = drawings;
    setIsSubmitted(true);
    syncToCloud({ drawings: newDrawings, isSubmitted: true });
  };

  const handleClick = (qIndex, optIndex) => {
    if (isRetakeMode) {
      if (retakeSubmitted || retakeAnswers[qIndex] !== undefined) return;
      setRetakeAnswers(prev => ({ ...prev, [qIndex]: optIndex }));
      return;
    }

    if (isSubmitted || isDrawingMode || selectedAnswers[qIndex] !== undefined) return;

    setSelectedAnswers(prevAnswers => {
      const newSelectedAnswers = { ...prevAnswers, [qIndex]: optIndex };

      setShowExp(prevShowExp => {
        const newShowExp = { ...prevShowExp, [qIndex]: true };
        syncToCloud({ selectedAnswers: newSelectedAnswers, showExp: newShowExp });
        return newShowExp;
      });

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
    activeCanvasIndex.current = index;
    const { offsetX, offsetY } = nativeEvent;
    const canvas = canvasRefs.current[index];
    if (!canvas) return;
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

    strokePoints.current = [{ x: offsetX, y: offsetY }];

    ctx.beginPath();
    ctx.moveTo(offsetX, offsetY);
  };

  const draw = (e, index) => {
    const { nativeEvent } = e;
    if (!isDrawing.current || !isDrawingMode || activeCanvasIndex.current !== index) return;
    const { offsetX, offsetY } = nativeEvent;
    const canvas = canvasRefs.current[index];
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

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
      ctx.lineTo(offsetX, offsetY);
      ctx.stroke();

      strokePoints.current.push({ x: offsetX, y: offsetY });
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

  const stopDrawing = (index) => {
    if (activeCanvasIndex.current !== index) return;
    clearTimeout(holdTimeout.current);
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
    <div style={{ padding: "20px", fontFamily: "Arial", maxWidth: "794px", margin: "0 auto" }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>{subjName} - {chapterName}</h2>
        <div style={{ display: "flex", gap: "10px" }}>
          <button onClick={() => navigate(`/quizzes/${subjectName}`)} style={{ padding: "8px 16px", ...btnBase }}>Back to Chapters</button>
        </div>
      </div>

      {/* Main Toolbar */}
      {!isRetakeMode && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: "15px", padding: "15px",
          background: (isDrawingMode || isHighlightMode) ? "#e3f2fd" : "#f5f5f5",
          borderRadius: "8px", marginBottom: "20px", alignItems: "center",
          border: (isDrawingMode || isHighlightMode) ? "2px solid #2196f3" : "2px solid transparent",
          transition: "all 0.3s ease"
        }}>

          <button
            onClick={() => { setIsDrawingMode(!isDrawingMode); setIsHighlightMode(false); }}
            style={{ ...btnBase, background: isDrawingMode ? "#f44336" : "#2196f3", color: "white" }}
          >
            {isDrawingMode ? "Close Pen ❌" : "Use Pen 🖋️"}
          </button>

          <button
            onClick={() => { setIsHighlightMode(!isHighlightMode); setIsDrawingMode(false); }}
            style={{ ...btnBase, background: isHighlightMode ? "#f44336" : "#ff9800", color: "white" }}
          >
            {isHighlightMode ? "Close Highlighter ❌" : "Use Highlighter 🖍️"}
          </button>

          {/* Highlighter Frame (Only visible when highlight mode) */}
          {isHighlightMode && (
            <div style={toolFrameStyle}>
              <span style={{ fontSize: "0.85rem", fontWeight: "bold", color: "#555" }}>Color:</span>
              <button onClick={() => setHighlightColor('#ffff00')} style={{ ...colorBtn(highlightColor === '#ffff00'), background: "#ffff00" }} title="Yellow"></button>
              <button onClick={() => setHighlightColor('#b2ff59')} style={{ ...colorBtn(highlightColor === '#b2ff59'), background: "#b2ff59" }} title="Green"></button>
              <button onClick={() => setHighlightColor('#ff8a80')} style={{ ...colorBtn(highlightColor === '#ff8a80'), background: "#ff8a80" }} title="Pink"></button>
            </div>
          )}

          {/* Pen Tools Frame (Only visible when drawing) */}
          {isDrawingMode && (
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <select value={drawTool} onChange={(e) => setDrawTool(e.target.value)} style={{ padding: "8px", borderRadius: "4px", border: "1px solid #ccc", outline: "none", fontWeight: "bold" }}>
                <option value="pen">Pen 🖋️</option>
                <option value="canvas-highlighter">Highlighter 🖍️</option>
                <option value="line">Line 📏</option>
                <option value="rectangle">Rect ▭</option>
                <option value="circle">Circle ◯</option>
                <option value="eraser">Eraser 🧽</option>
              </select>

              <button onClick={() => handleUndo(current)} style={{ ...btnBase, background: "#fff", border: "1px solid #ccc", color: "#333" }} title="Undo Last Stroke">
                Undo ↩️
              </button>

              {drawTool !== 'eraser' && (
                <>
                  <div style={toolFrameStyle}>
                    <span style={{ fontSize: "0.85rem", fontWeight: "bold", color: "#555" }}>Ink:</span>
                    <button onClick={() => setPenColor('#ff0000')} style={{ ...colorBtn(penColor === '#ff0000'), background: "#ff0000" }} title="Red"></button>
                  <button onClick={() => setPenColor('#2196f3')} style={{ ...colorBtn(penColor === '#2196f3'), background: "#2196f3" }} title="Blue"></button>
                  <button onClick={() => setPenColor('#4caf50')} style={{ ...colorBtn(penColor === '#4caf50'), background: "#4caf50" }} title="Green"></button>
                  <button onClick={() => setPenColor('#ff9800')} style={{ ...colorBtn(penColor === '#ff9800'), background: "#ff9800" }} title="Orange"></button>
                  <button onClick={() => setPenColor('#9c27b0')} style={{ ...colorBtn(penColor === '#9c27b0'), background: "#9c27b0" }} title="Purple"></button>
                  <button onClick={() => setPenColor('#000000')} style={{ ...colorBtn(penColor === '#000000'), background: "#000000" }} title="Black"></button>
                  </div>
                  <div style={{ ...toolFrameStyle, width: "120px" }}>
                    <span style={{ fontSize: "0.85rem", fontWeight: "bold", color: "#555" }}>Size:</span>
                    <input type="range" min="1" max="20" value={penWidth} onChange={(e) => setPenWidth(Number(e.target.value))} style={{ width: "100%", cursor: "pointer" }} />
                  </div>
                </>
              )}
            </div>
          )}

          {!isSubmitted && hasEditsOnPage && (
            <button onClick={() => clearPage(current)} style={{ ...btnBase, background: "#fff", border: "1px solid #ccc", color: "#d32f2f", marginLeft: "auto" }}>
              Erase Page Annotations 🧽
            </button>
          )}
        </div>
      )}

      {/* Quiz Area */}
      <div style={{ background: "white", minHeight: "300px" }}>
        {questions.map((q, index) => {
          const showAll = isSubmitted && !isRetakeMode;
          if (!showAll && index !== current) return null;

          return (
            <div
              key={index}
              ref={el => questionContainersRef.current[index] = el}
              style={{ position: "relative", padding: "10px", marginBottom: showAll ? "40px" : "0", borderBottom: showAll && index < questions.length - 1 ? "2px dashed #ccc" : "none" }}
            >
              {!isRetakeMode && (
                <canvas
                  ref={el => canvasRefs.current[index] = el}
                  onPointerDown={(e) => { e.target.setPointerCapture(e.pointerId); startDrawing(e, index); }}
                  onPointerMove={(e) => draw(e, index)}
                  onPointerUp={(e) => { e.target.releasePointerCapture(e.pointerId); stopDrawing(index); }}
                  onPointerOut={() => stopDrawing(index)}
                  onPointerCancel={() => stopDrawing(index)}
                  style={{
                    position: "absolute", top: 0, left: 0, zIndex: 10,
                    opacity: 1,
                    pointerEvents: isDrawingMode ? "auto" : "none",
                    touchAction: "none",
                    cursor: isDrawingMode ? (drawTool === 'eraser' ? 'cell' : 'crosshair') : 'default'
                  }}
                />
              )}

              <h3>Question {index + 1} / {questions.length}</h3>
              <p style={{ fontSize: '1.2rem', fontWeight: 'bold', userSelect: isDrawingMode ? "none" : "auto" }}>
                {q.question}
              </p>

              {q.options.map((opt, i) => {
                let isDisabled = false;
                let bg = "#f9f9f9";
                let color = "black";
                let opacity = 1;

                if (isRetakeMode) {
                  isDisabled = retakeSubmitted || retakeAnswers[index] !== undefined;
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
                  isDisabled = isSubmitted || isDrawingMode || selectedAnswers[index] !== undefined;
                  if (selectedAnswers[index] !== undefined) {
                    bg = i === q.correct ? "#4caf50" : i === selectedAnswers[index] ? "#f44336" : "#f9f9f9";
                    color = (i === q.correct || i === selectedAnswers[index]) ? "white" : "black";
                  }
                  if ((isSubmitted || isDrawingMode) && selectedAnswers[index] === undefined) opacity = 0.7;
                }

                return (
                  <button
                    key={i}
                    onClick={() => handleClick(index, i)}
                    disabled={isDisabled}
                    style={{
                      display: "block", margin: "10px 0", padding: "10px", width: "100%", maxWidth: "500px",
                      textAlign: "left", border: "1px solid #ccc", borderRadius: "4px",
                      background: bg,
                      color: color,
                      opacity: opacity,
                      cursor: isDisabled ? "default" : "pointer"
                    }}
                  >
                    {opt}
                  </button>
                );
              })}

              {!isRetakeMode && (isSubmitted || showExp[index]) && q.explanation && (
                <div style={{ marginTop: "20px", position: "relative", zIndex: isDrawingMode ? 0 : 11 }}>

                  {/* Original Explanation with Highlighter support */}
                  <strong>Explanation <span style={{ color: "#666", fontSize: "0.9rem", fontWeight: "normal" }}>{isHighlightMode ? "(Drag to highlight)" : ""}</span>:</strong>
                  <div
                    ref={el => explanationRefs.current[index] = el}
                    contentEditable={isHighlightMode}
                    suppressContentEditableWarning
                    onPointerUp={() => handleMouseUp(index)}
                    onTouchEnd={() => handleMouseUp(index)}
                    style={{
                      border: "1px solid #ccc", borderRadius: "4px", padding: "15px", marginTop: "5px", background: "#fff8e1",
                      cursor: isHighlightMode ? "text" : "default", userSelect: isDrawingMode ? "none" : "auto"
                    }}
                    dangerouslySetInnerHTML={{ __html: savedExplanations[index] ? savedExplanations[index] : `<span>${q.explanation}</span>` }}
                  />
                  {savedExplanations[index] && (
                    <button onClick={() => clearHighlight(index)} disabled={isDrawingMode} style={{ marginTop: "6px", padding: "4px 8px", fontSize: "0.82rem", cursor: "pointer" }}>
                      Clear Highlight
                    </button>
                  )}

                  {/* Rich Text Notes Editor */}
                  {/* Formatting Toolbar */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", padding: "6px 8px", background: "#f5f5f5", border: "1px solid #d0d0d0", borderBottom: "none", borderRadius: "6px 6px 0 0", marginTop: "16px" }}>
                    {[
                      { cmd: 'bold',           label: 'B',  title: 'Bold',          style: { fontWeight: 'bold' } },
                      { cmd: 'italic',         label: 'I',  title: 'Italic',        style: { fontStyle: 'italic' } },
                      { cmd: 'underline',      label: 'U',  title: 'Underline',     style: { textDecoration: 'underline' } },
                      { cmd: 'strikeThrough',  label: 'S\u0336',  title: 'Strikethrough', style: { textDecoration: 'line-through' } },
                    ].map(({ cmd, label, title, style: s }) => (
                      <button key={cmd} title={title} onMouseDown={(e) => { e.preventDefault(); document.execCommand(cmd); }} style={{ ...s, padding: '2px 8px', border: '1px solid #ccc', borderRadius: '3px', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' }}>{label}</button>
                    ))}
                    <div style={{ width: '1px', background: '#ccc', margin: '0 4px' }} />
                    {[
                      { cmd: 'insertUnorderedList', label: '• List',  title: 'Bullet List' },
                      { cmd: 'insertOrderedList',   label: '1. List', title: 'Numbered List' },
                    ].map(({ cmd, label, title }) => (
                      <button key={cmd} title={title} onMouseDown={(e) => { e.preventDefault(); document.execCommand(cmd); }} style={{ padding: '2px 8px', border: '1px solid #ccc', borderRadius: '3px', background: '#fff', cursor: 'pointer', fontSize: '0.82rem' }}>{label}</button>
                    ))}
                    <div style={{ width: '1px', background: '#ccc', margin: '0 4px' }} />
                    <select title="Heading" defaultValue="" onMouseDown={(e) => e.stopPropagation()} onChange={(e) => { document.execCommand('formatBlock', false, e.target.value); e.target.value = ''; }} style={{ padding: '2px 4px', border: '1px solid #ccc', borderRadius: '3px', background: '#fff', fontSize: '0.82rem', cursor: 'pointer' }}>
                      <option value="" disabled>Style</option>
                      <option value="h1">Title</option>
                      <option value="h2">Heading</option>
                      <option value="h3">Subheading</option>
                      <option value="p">Body</option>
                    </select>
                    <div style={{ width: '1px', background: '#ccc', margin: '0 4px' }} />
                    <label title="Text Color" style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.82rem', cursor: 'pointer' }}>
                      A
                      <input type="color" defaultValue="#ff0000" onChange={(e) => document.execCommand('foreColor', false, e.target.value)} style={{ width: '20px', height: '20px', border: 'none', padding: 0, cursor: 'pointer' }} />
                    </label>
                    <label title="Highlight Color" style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.82rem', cursor: 'pointer' }}>
                      🖍
                      <input type="color" defaultValue="#ffff00" onChange={(e) => document.execCommand('hiliteColor', false, e.target.value)} style={{ width: '20px', height: '20px', border: 'none', padding: 0, cursor: 'pointer' }} />
                    </label>
                    <div style={{ width: '1px', background: '#ccc', margin: '0 4px' }} />
                    <button title="Clear Formatting" onMouseDown={(e) => { e.preventDefault(); document.execCommand('removeFormat'); }} style={{ padding: '2px 8px', border: '1px solid #ccc', borderRadius: '3px', background: '#fff', cursor: 'pointer', fontSize: '0.82rem' }}>✕ Clear</button>
                  </div>

                  {/* Editable Notes Area */}
                  <div
                    contentEditable={!isDrawingMode}
                    suppressContentEditableWarning
                    ref={el => {
                      if (!el) return;
                      if (!el.dataset.hydrated) {
                        el.innerHTML = notes[index] || '';
                        el.dataset.hydrated = 'true';
                      }
                    }}
                    onInput={(e) => {
                      const content = e.currentTarget.innerHTML;
                      setNotes(prev => {
                        const updated = { ...prev, [index]: content };
                        syncToCloud({ notes: updated });
                        return updated;
                      });
                    }}
                    style={{
                      minHeight: "160px", padding: "12px", border: "1px solid #d0d0d0",
                      borderRadius: "0 0 6px 6px", background: "#fffef5", outline: "none",
                      fontSize: "0.95rem", lineHeight: "1.6", cursor: isDrawingMode ? "default" : "text",
                      userSelect: isDrawingMode ? "none" : "auto"
                    }}
                  />

                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer Tracker Navigation */}
      {(!isSubmitted || isRetakeMode) && (
        <div style={{ marginTop: "30px", display: "flex", gap: "5px", flexWrap: "wrap" }}>
          {questions.map((_, index) => {
            const isAnswered = isRetakeMode ? retakeAnswers[index] !== undefined : selectedAnswers[index] !== undefined;
            return (
              <button
                key={index}
                onClick={() => handleQuestionChange(index)}
                style={{
                  padding: "8px 12px", border: "none", borderRadius: "4px", cursor: "pointer",
                  background: current === index ? "#2196f3" : isAnswered ? "#4caf50" : "#e0e0e0",
                  color: current === index || isAnswered ? "white" : "black"
                }}
              >
                {index + 1}
              </button>
            );
          })}
        </div>
      )}

      {(!isSubmitted || isRetakeMode) && (
        <div style={{ marginTop: "20px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button onClick={prevQuestion} disabled={current === 0} style={btnBase}>Previous</button>
          <button onClick={nextQuestion} disabled={current === questions.length - 1} style={btnBase}>Next</button>

          {current === questions.length - 1 && (!isRetakeMode || !retakeSubmitted) && (
            <button onClick={() => isRetakeMode ? setRetakeSubmitted(true) : submitQuiz()} style={{ ...btnBase, background: "#ff9800", color: "white", marginLeft: "auto" }}>
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
            <button onClick={downloadPDF} style={{ ...btnBase, background: "#2196f3", color: "white", fontSize: "1.1rem", padding: "12px 24px" }}>
              Download Study Notes (PDF) 📥
            </button>
            <button onClick={() => { setIsRetakeMode(true); setRetakeAnswers({}); setRetakeSubmitted(false); setCurrent(0); }} style={{ ...btnBase, background: "#ff9800", color: "white", fontSize: "1.1rem", padding: "12px 24px" }}>
              Re-take Quiz 🔄
            </button>
            <button onClick={clearAnnotations} style={{ ...btnBase, background: "#f44336", color: "white", fontSize: "1.1rem", padding: "12px 24px" }}>
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