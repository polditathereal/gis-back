const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://gis_db_user:Ipvqk1K1PVBWIQaQ@cluster0.piofw8c.mongodb.net/gisdb';
const DB_NAME = process.env.MONGODB_DB || 'gisdb';
const dataDir = path.join(__dirname, 'data');

// Utilidad para escribir un array en un archivo JSON
function writeArrayToFile(arr, file) {
  fs.writeFileSync(file, JSON.stringify(arr, null, 2), 'utf8');
}

// 1. Extraer y guardar arrays de projects.json
const projectsJson = JSON.parse(fs.readFileSync(path.join(dataDir, 'projects.json'), 'utf8'));
writeArrayToFile(projectsJson.projects, 'projects_only.json');
writeArrayToFile(projectsJson.categories, 'projectCategories.json');

// 2. Extraer y guardar arrays de news.json
const newsJson = JSON.parse(fs.readFileSync(path.join(dataDir, 'news.json'), 'utf8'));
writeArrayToFile(newsJson.news, 'news_only.json');
writeArrayToFile(newsJson.categories, 'newsCategories.json');

// 3. Extraer y guardar arrays de jobs.json
const jobsJson = JSON.parse(fs.readFileSync(path.join(dataDir, 'jobs.json'), 'utf8'));
writeArrayToFile(jobsJson.jobs, 'jobs_only.json');
writeArrayToFile(jobsJson.categories, 'jobCategories.json');

// 4. Copiar users.json tal cual
fs.copyFileSync(path.join(dataDir, 'users.json'), 'users.json');

// 5. Función para importar usando mongoimport
function mongoImport(collection, file) {
  const cmd = `mongoimport --uri "${MONGO_URI}" --collection ${collection} --jsonArray --file ${file} --drop`;
  console.log(`Importando ${file} a colección ${collection}...`);
  try {
    execSync(cmd, { stdio: 'inherit' });
    console.log(`✔️  ${collection} importada correctamente.`);
  } catch (e) {
    console.error(`❌ Error importando ${collection}:`, e.message);
  }
}

// 6. Importar a MongoDB Atlas
mongoImport('projects', 'projects_only.json');
mongoImport('projectCategories', 'projectCategories.json');
mongoImport('news', 'news_only.json');
mongoImport('newsCategories', 'newsCategories.json');
mongoImport('jobs', 'jobs_only.json');
mongoImport('jobCategories', 'jobCategories.json');
mongoImport('users', 'users.json');

// 7. Limpieza: elimina archivos temporales si quieres
// ['projects_only.json','projectCategories.json','news_only.json','newsCategories.json','jobs_only.json','jobCategories.json','users.json'].forEach(f => fs.unlinkSync(f));

console.log('Migración a MongoDB Atlas finalizada.');
