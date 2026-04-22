import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { loadQuiz } from '../utils/loadQuiz';

function Quiz() {
  const { subjectName, chapterId } = useParams();
  const navigate = useNavigate();

  // --- Dynamic Data State ---
  const [quizData, setQuizData] = useState(null);
  const [loading, setLoading] = useState(true);

  // --- Quiz Interaction State ---
  const [current, setCurrent] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [showExp, setShowExp] = useState({});
  const [savedExplanations, setSavedExplanations] = useState({});
  const [isSubmitted, setIsSubmitted] = useState(false);

  const explanationRef = useRef(null);

  // Load the specific quiz data
  useEffect(() => {
    loadQuiz(subjectName, chapterId).then(data => {
      setQuizData(data);
      setLoading(false);
    });
  }, [subjectName, chapterId]);

  if (loading) return <h2>Loading quiz...</h2>;
  if (!quizData) return <h2>Quiz not found for {subjectName} chapter {chapterId}</h2>;

  const { questions, subjectName: subjName, chapterName } = quizData;

  const handleClick = (index) => {
    if (isSubmitted) return;
    setSelectedAnswers((prev) => ({ ...prev, [current]: index }));
    setShowExp((prev) => ({ ...prev, [current]: true }));
  };

  const nextQuestion = () => {
    if (current < questions.length - 1) setCurrent(current + 1);
  };

  const prevQuestion = () => {
    if (current > 0) setCurrent(current - 1);
  };

  // --- Highlight Logic ---
  const handleMouseUp = () => {
    if (isSubmitted) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    if (range.toString().length === 0) return;

    try {
      const span = document.createElement("span");
      span.style.backgroundColor = "yellow";

      range.surroundContents(span);
      selection.removeAllRanges();

      const updatedHTML = explanationRef.current.innerHTML;

      setSavedExplanations((prev) => ({
        ...prev,
        [current]: updatedHTML
      }));
    } catch (err) {
      console.log(err);
    }
  };

  const clearHighlight = () => {
    if (isSubmitted) return;

    setSavedExplanations((prev) => {
      const updated = { ...prev };
      delete updated[current];
      return updated;
    });

    if (explanationRef.current) {
      explanationRef.current.innerHTML = questions[current].explanation;
    }
  };

  const clearAllHighlights = () => {
    setSavedExplanations({});
    if (explanationRef.current) {
      explanationRef.current.innerHTML = questions[current].explanation;
    }
  };

  const submitQuiz = () => {
    setIsSubmitted(true);
  };

  // --- PDF Logic ---
  const downloadPDF = async () => {
    const element = document.getElementById("pdf-container");
    const canvas = await html2canvas(element, { scale: 2 });
    const imgData = canvas.toDataURL("image/png");

    const pdf = new jsPDF();
    
    // Calculate width and height to fit the page properly
    const imgWidth = 190; 
    const pageHeight = 295;  
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 10;

    pdf.addImage(imgData, "PNG", 10, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    // Handle multiple pages if the quiz is long
    while (heightLeft >= 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", 10, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    pdf.save(`${subjName}-${chapterName}-Quiz.pdf`);
  };

  return (
    <div style={{ padding: "20px", fontFamily: "Arial", maxWidth: "800px", margin: "0 auto" }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>{subjName} - {chapterName}</h2>
        <button onClick={() => navigate(`/quizzes/${subjectName}`)}>Back to Chapters</button>
      </div>

      <h3>Question {current + 1} / {questions.length}</h3>
      <p style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{questions[current].question}</p>

      {/* OPTIONS */}
      {questions[current].options.map((opt, i) => (
        <button
          key={i}
          onClick={() => handleClick(i)}
          disabled={isSubmitted}
          style={{
            display: "block",
            margin: "10px 0",
            padding: "10px",
            width: "100%",
            maxWidth: "400px",
            textAlign: "left",
            border: "1px solid #ccc",
            borderRadius: "4px",
            background:
              selectedAnswers[current] !== undefined
                ? i === questions[current].correct
                  ? "#4caf50" // green
                  : i === selectedAnswers[current]
                  ? "#f44336" // red
                  : "#f9f9f9"
                : "#f9f9f9",
            color: selectedAnswers[current] !== undefined && (i === questions[current].correct || i === selectedAnswers[current]) ? "white" : "black",
            opacity: isSubmitted ? 0.8 : 1,
            cursor: isSubmitted ? "not-allowed" : "pointer"
          }}
        >
          {opt}
        </button>
      ))}

      {/* EXPLANATION */}
      {showExp[current] && questions[current].explanation && (
        <div style={{ marginTop: "20px" }}>
          <strong>Explanation (Highlight important text):</strong>
          <div
            ref={explanationRef}
            contentEditable={!isSubmitted}
            suppressContentEditableWarning
            onMouseUp={handleMouseUp}
            style={{
              border: "1px solid black",
              borderRadius: "4px",
              padding: "15px",
              marginTop: "10px",
              minHeight: "60px",
              background: "#fff8e1" // light yellow background to distinguish it
            }}
            dangerouslySetInnerHTML={{
              __html:
                savedExplanations[current] ||
                `<span>${questions[current].explanation}</span>`
            }}
          />
          <div style={{ marginTop: "10px" }}>
            <button onClick={clearHighlight} disabled={isSubmitted}>
              Clear Highlight
            </button>
          </div>
        </div>
      )}

      {/* TRACKER */}
      <div style={{ marginTop: "30px", display: "flex", flexWrap: "wrap", gap: "5px" }}>
        {questions.map((_, index) => (
          <button
            key={index}
            onClick={() => setCurrent(index)}
            style={{
              padding: "8px 12px",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              background:
                current === index
                  ? "#2196f3" // blue
                  : selectedAnswers[index] !== undefined
                  ? "#4caf50" // green
                  : "#e0e0e0",
              color: current === index || selectedAnswers[index] !== undefined ? "white" : "black"
            }}
          >
            {index + 1}
          </button>
        ))}
      </div>

      {/* NAVIGATION & SUBMISSION */}
      <div style={{ marginTop: "20px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <button onClick={prevQuestion} disabled={current === 0}>
          Previous
        </button>
        <button onClick={nextQuestion} disabled={current === questions.length - 1}>
          Next
        </button>

        {!isSubmitted && current === questions.length - 1 && (
          <button onClick={submitQuiz} style={{ background: "#ff9800", color: "white", marginLeft: "auto" }}>
            Submit Quiz
          </button>
        )}
      </div>

      {/* AFTER SUBMIT ACTIONS */}
      {isSubmitted && (
        <div style={{ marginTop: "30px", padding: "20px", background: "#e8f5e9", borderRadius: "4px" }}>
          <h3>Quiz Submitted!</h3>
          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={downloadPDF} style={{ background: "#2196f3", color: "white" }}>
              Download PDF with Highlights
            </button>
            <button onClick={clearAllHighlights}>
              Clear All Highlights
            </button>
          </div>
        </div>
      )}

      {/* HIDDEN PDF DATA CONTAINER */}
      <div 
        id="pdf-container" 
        style={{ 
          position: "absolute", 
          left: "-9999px", 
          top: "-9999px",
          width: "800px", 
          padding: "40px", 
          background: "white", 
          color: "black",
          fontFamily: "Arial"
        }}
      >
        <h2>{subjName} - {chapterName} (Review)</h2>
        <hr />
        {questions.map((q, index) => (
          <div key={index} style={{ marginBottom: "30px" }}>
            <h3 style={{ marginBottom: "10px" }}>Q{index + 1}: {q.question}</h3>
            {q.options.map((opt, i) => (
              <p key={i} style={{ 
                margin: "5px 0", 
                padding: "5px",
                background: i === q.correct ? "#c8e6c9" : "transparent",
                fontWeight: i === q.correct ? "bold" : "normal"
              }}>
                {i === q.correct ? "✔ " : "○ "} {opt}
              </p>
            ))}
            <div style={{ marginTop: "10px", padding: "10px", borderLeft: "4px solid #ffeb3b", background: "#fdfbf7" }}>
              <strong>Explanation: </strong>
              <span
                dangerouslySetInnerHTML={{
                  __html:
                    savedExplanations[index] ||
                    `<span>${q.explanation}</span>`
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Quiz;