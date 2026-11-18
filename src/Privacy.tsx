import { useEffect, useState, type FormEvent } from 'react'
import { api, errorMessage } from './api'
import { t, getLanguage, locale } from './i18n'

export type Policy={version:string;text:string;textRu:string;publishedAt:number|null;approved:boolean}
const privacyTemplateKK=`ДЕРБЕС ДЕРЕКТЕРДІ ӨҢДЕУ ШАРТТАРЫ — ЖОБА

1. Жауапты ұйым және байланыс
[Ұйымның толық атауын, мекенжайын, байланыс телефонын және деректер бойынша өтініш қабылдайтын мекенжайын толтырыңыз.]

2. Жиналатын деректер және мақсат
Қабылдауға жазылу үшін аты-жөніңіз, телефон нөміріңіз, таңдаған бөлім, күн мен уақыт, мәселенің сипаттамасы және келісімнің мәтіні, нұсқасы мен берілген уақыты сақталады. Қабылдаудан кейін өз қалауыңызбен баға және пікір қалдыра аласыз. Қызметкерлердің аккаунттары мен әрекеттер журналы жүйеге рұқсатты басқару және қауіпсіздік үшін өңделеді.

3. Қолжетімділік
Жазылуды ұйым әкімшісі және тиісті бөлімге рұқсаты бар қызметкерлер өңдейді. Ішкі қызметтік ескертулер азаматтарға көрсетілмейді. Талонға телефон мен жеке код арқылы қол жеткізуге болады. Код пен QR талонды басқа адамға бермеңіз.

4. Сақтау және жою
[Негізгі жазбалар, қызметтік журналдар және сақтық көшірмелер үшін ұйым бекіткен сақтау мерзімдерін, жою тәртібін және жауапты тұлғаны енгізіңіз.] Жүйедегі автоматты сақтық көшірменің сақтау мерзімі сервер баптауынан басқарылады. Талоннан бас тарту бұрын сақталған деректерді автоматты жоймайды.

5. Сіздің өтініштеріңіз
Мәліметтерді нақтылау, оларға қол жеткізу, келісімді қайтарып алу немесе жоюды сұрау үшін жоғарыдағы ұйымның байланыс арнасына жүгініңіз. [Ұйымның өтінішті қарау тәртібі мен мерзімін енгізіңіз.] Қабылдау басталғанға дейін «Талоным» бөлімінде жазылудан бас тартуға болады.

6. Орналастыру және өзге қызметтер
[Дерекқор мен көшірмелердің нақты орналасуын, хостинг жеткізушісін, деректер алатын өзге ұйымдарды және қолданылатын байланыс арналарын көрсетіңіз.] Қазіргі жүйеде SMS, eGov және ЭЦҚ интеграциялары іске қосылмаған.

7. Келісім
Жазылу кезінде белгі қою арқылы осы көрсетілген шарттармен танысқаныңызды және қабылдауды ұйымдастыру үшін деректерді өңдеуге келісетініңізді растайсыз. Келісім мәтіні, оның нұсқасы және берілген уақыты жазылумен бірге сақталады.

[Жариялаудан бұрын жақшадағы барлық өрісті толтырып, мәтінді ұйымның жауапты тұлғасымен бекітіңіз.]`
const privacyTemplateRU=`УСЛОВИЯ ОБРАБОТКИ ПЕРСОНАЛЬНЫХ ДАННЫХ — ПРОЕКТ

1. Ответственная организация и контакты
[Укажите полное наименование, адрес, телефон организации и адрес для обращений по персональным данным.]

2. Данные и цели обработки
Для организации приёма сохраняются имя и фамилия, номер телефона, отдел, дата и время, описание вопроса, текст, версия и время согласия. После приёма можно добровольно оставить оценку и комментарий. Данные учётных записей сотрудников и журнал действий используются для управления доступом и безопасности.

3. Доступ
Запись обрабатывают администратор организации и сотрудники с доступом к соответствующему отделу. Внутренние служебные заметки гражданам не показываются. Доступ к талону возможен по телефону и личному коду. Не передавайте другим код и QR талона.

4. Хранение и удаление
[Укажите утверждённые организацией сроки хранения основных записей, служебных журналов и резервных копий, порядок удаления и ответственное лицо.] Срок хранения автоматических резервных копий задаётся в настройках сервера. Отмена записи не удаляет ранее сохранённые данные автоматически.

5. Ваши обращения
Для уточнения данных, получения доступа, отзыва согласия или запроса удаления обратитесь в организацию по указанным контактам. [Укажите порядок и сроки рассмотрения обращений.] До начала приёма можно отменить запись в разделе «Мой талон».

6. Размещение и другие сервисы
[Укажите фактическое расположение базы и копий, поставщика хостинга, других получателей данных и используемые каналы связи.] В текущей системе не подключены SMS, eGov и ЭЦП.

7. Согласие
Отметка при записи подтверждает ознакомление с показанными условиями и согласие на обработку данных для организации приёма. Текст, версия и время согласия сохраняются вместе с записью.

[До публикации заполните все поля в скобках и согласуйте текст с ответственным лицом организации.]`

export function PrivacyPage() {
  const [policy,setPolicy]=useState<Policy|null>(null),[error,setError]=useState('')
  useEffect(()=>{const controller=new AbortController();api<{policy:Policy}>('/api/privacy',undefined,'GET',controller.signal).then(result=>{if(!controller.signal.aborted)setPolicy(result.policy)}).catch(error=>{if(!controller.signal.aborted)setError(errorMessage(error))});return()=>controller.abort()},[])
  return <section className="container interior narrow privacy-page"><h1>{t('Дербес деректерді өңдеу шарттары')}</h1>{error&&<p className="alert" role="alert">{t(error)}</p>}{policy?<><p className="hint">{t('Нұсқа')}: {policy.version.slice(0,12)}{policy.publishedAt&&<> · {new Intl.DateTimeFormat(locale(),{dateStyle:'long',timeZone:'Asia/Qyzylorda'}).format(policy.publishedAt)}</>}</p>{!policy.approved&&<p className="notice">{t('Ұйымның жеке шарттары әзірге жарияланбаған. Төменде жүйедегі деректерді пайдалану туралы негізгі түсіндірме берілген.')}</p>}<div className="panel preserve">{getLanguage()==='ru'&&policy.textRu?policy.textRu:t(policy.text)}</div></>:!error&&<p role="status">{t('Жүктелуде…')}</p>}<a href="#booking" className="text-button">{t('Қабылдауға жазылу →')}</a></section>
}

export default function PrivacyEditor() {
  const [text,setText]=useState(''),[textRu,setTextRu]=useState(''),[loaded,setLoaded]=useState(false),[approved,setApproved]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[policy,setPolicy]=useState<Policy|null>(null)
  useEffect(()=>{
    const controller=new AbortController()
    api<{policy:Policy;draft:{text:string;textRu:string}|null}>('/api/admin/privacy',undefined,'GET',controller.signal).then(result=>{
      if(controller.signal.aborted)return
      setPolicy(result.policy);setText(result.draft?.text||(result.policy.approved?result.policy.text:privacyTemplateKK));setTextRu(result.draft?.textRu||(result.policy.approved?result.policy.textRu:privacyTemplateRU));setLoaded(true)
    }).catch(error=>{if(!controller.signal.aborted)setError(errorMessage(error))})
    return()=>controller.abort()
  },[])
  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError('');setMessage('')
    const action=(event.nativeEvent as SubmitEvent).submitter?.getAttribute('value')==='publish'?'publish':'draft'
    try {const result=await api<{policy:Policy}>('/api/admin/privacy',{text,textRu,approved,action});setPolicy(result.policy);setApproved(false);setMessage(action==='publish'?'Шарттардың жаңа нұсқасы жарияланды.':'Шарттар нобайы сақталды. Азаматтарға көрсетілетін нұсқа өзгерген жоқ.')}
    catch(error){setError(errorMessage(error))}finally{setBusy(false)}
  }
  return <section className="panel privacy-editor"><h2>{t('Деректерді өңдеу шарттарын басқару')}</h2><p className="notice">{t('Бұл — толтыруға арналған үлгі. Ұйым мәліметтерін, сақтау мерзімін және өтініш беру тәртібін өздеріңіз енгізіп, жариялаудан бұрын бекітіңіздер.')}</p>{policy&&<p>{t(policy.approved?'Бекітілген нұсқа жарияланған.':'Бекітілген нұсқа әлі жарияланбаған.')} <a className="inline-link" href="#privacy">{t('Азамат көретін шарттарды ашу')}</a></p>}<form onSubmit={save}><fieldset disabled={busy||!loaded} className="auth-fields"><label>{t('Қазақша шарттар')}<textarea name="privacyKK" rows={16} required maxLength={12000} value={text} onChange={event=>{setText(event.target.value);setApproved(false)}}/></label><label>{t('Орысша шарттар')}<textarea name="privacyRU" rows={16} maxLength={12000} value={textRu} onChange={event=>{setTextRu(event.target.value);setApproved(false)}}/></label><label className="check"><input name="privacyApproval" type="checkbox" checked={approved} onChange={event=>setApproved(event.target.checked)}/>{t('Екі тілдегі мәтін ұйымның жауапты тұлғасымен бекітілді және жариялауға дайын.')}</label><div className="actions"><button className="outline" type="submit" value="draft">{t('Нобайды сақтау')}</button><button className="primary" type="submit" value="publish" disabled={!approved}>{t('Бекітілген нұсқаны жариялау')}</button></div></fieldset></form>{error&&<p role="alert" className="alert">{t(error)}</p>}{message&&<p role="status" className="notice">{t(message)}</p>}</section>
}
