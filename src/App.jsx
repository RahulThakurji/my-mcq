import { Routes, Route } from 'react-router-dom';
import 'katex/dist/katex.min.css';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import Courses from './pages/Courses';
import Quizzes from './pages/Quizzes';
import Subject from './pages/Subject';
import Quiz from './pages/Quiz';
import Contact from './pages/Contact';
import About from './pages/About';
import Ebooks from './pages/Ebooks';
import EbookReader from './pages/EbookReader';



function App() {
  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/courses" element={<Courses />} />
        <Route path="/quizzes" element={<Quizzes />} />
        <Route path="/quizzes/:subjectName" element={<Subject />} />
        <Route path="/quiz/:subjectName/chapter/:chapterId" element={<Quiz />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/about" element={<About />} />
        <Route path="/ebooks" element={<Ebooks />} />
        <Route path="/ebook/:ebookId/chapter/:chapterId" element={<EbookReader />} />
      </Routes>


    </>
  );
}

export default App;
