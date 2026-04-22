export async function loadQuiz(subjectName, chapterNumber) {
   try {
     const module = await import(`../data/quizzes/${subjectName}/chapter${chapterNumber}.js`);
     return module.default;
   } catch (error) {
     console.error(`Failed to load quiz for ${subjectName} chapter ${chapterNumber}`, error);
     return null;
   }
}