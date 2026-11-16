import { useLanguage } from './use-language'

export default function LanguageSwitch() {
  const {language,setLanguage}=useLanguage()
  return <div className="language-switch" role="group" aria-label="Тіл / Язык">
    <button type="button" lang="kk" aria-pressed={language==='kk'} onClick={()=>setLanguage('kk')}>ҚАЗ</button>
    <button type="button" lang="ru" aria-pressed={language==='ru'} onClick={()=>setLanguage('ru')}>РУС</button>
  </div>
}
