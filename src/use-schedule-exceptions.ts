import { useEffect, useState } from 'react'
import { api, errorMessage } from './api'
import { addDays } from './reception-calendar'
import type { ReceptionException } from './reception-calendar'

export function useScheduleExceptions(departmentId:string,from:string) {
  const [result,setResult]=useState<{key:string;exceptions:ReceptionException[]}|null>(null)
  const [failure,setFailure]=useState<{key:string;message:string}|null>(null)
  const [retry,setRetry]=useState(0)
  const key=JSON.stringify([departmentId,from])
  useEffect(()=>{
    if(!departmentId)return
    const controller=new AbortController()
    const query=new URLSearchParams({departmentId,from,to:addDays(from,90)})
    api<{exceptions:ReceptionException[]}>(`/api/schedule-exceptions?${query}`,undefined,'GET',controller.signal)
      .then(data=>{if(!controller.signal.aborted){setResult({key,exceptions:data.exceptions});setFailure(null)}})
      .catch(error=>{if(!controller.signal.aborted)setFailure({key,message:errorMessage(error)})})
    return()=>controller.abort()
  },[departmentId,from,key,retry])
  return {exceptions:result?.key===key?result.exceptions:[],ready:result?.key===key,error:failure?.key===key?failure.message:'',refresh:()=>setRetry(value=>value+1)}
}
