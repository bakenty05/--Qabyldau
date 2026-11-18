import { resolve } from 'node:path'
import { restoreToNewFile, verifyDatabase } from '../server/operations.mjs'
const [source,destination]=process.argv.slice(2)
if(!source) throw new Error('Тексеру: npm run restore -- <backup.sqlite>. Жаңа файлға қалпына келтіру: npm run restore -- <backup.sqlite> <new.sqlite>')
console.log(JSON.stringify(destination?restoreToNewFile(resolve(source),resolve(destination)):{verified:true,counts:verifyDatabase(resolve(source))},null,2))
