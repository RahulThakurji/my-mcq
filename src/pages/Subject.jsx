import { useParams, Link } from 'react-router-dom';
import { subjects, chaptersBySubject } from '../data/subjectsConfig';

function Subject() {
   const { subjectName } = useParams();
   const subject = subjects.find(s => s.folder === subjectName);
   const chapters = chaptersBySubject[subject?.id] || [];

   if (!subject) return <h2>Subject not found</h2>;

   return (
     <div>
       <h1>{subject.name} – Chapters</h1>
       <ul>
         {chapters.map((chapterName, idx) => (
           <li key={idx}>
             <Link to={`/quiz/${subject.folder}/chapter/${idx + 1}`}>
               {chapterName}
             </Link>
           </li>
         ))}
       </ul>
     </div>
   );
}

export default Subject;