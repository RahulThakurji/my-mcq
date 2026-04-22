import { Link } from 'react-router-dom';
import { subjects } from '../data/subjectsConfig';

function Quizzes() {
   return (
     <div>
       <h1>Select a Subject</h1>
       <ul>
         {subjects.map(sub => (
           <li key={sub.id}>
             <Link to={`/quizzes/${sub.folder}`}>{sub.name}</Link>
           </li>
         ))}
       </ul>
     </div>
   );
}

export default Quizzes;