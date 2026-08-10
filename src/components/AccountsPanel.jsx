import { useEffect, useState } from 'react'
import {
  cancelAccountLogin,
  deleteAccount,
  finishAccountLogin,
  getAccountLoginStatus,
  getAccounts,
  renameAccount,
  restartAccountLogin,
  startAccountLogin,
} from '../api'

function sessionExpiryLabel(value) {
  if (!value) return { text: 'วันหมดอายุ: Facebook ไม่ได้ระบุใน Cookie', className: 'text-slate-400' }
  const expiresAt = new Date(value)
  const remaining = expiresAt.getTime() - Date.now()
  if (remaining <= 0) return { text: `Cookie หมดอายุแล้ว · ${expiresAt.toLocaleString('th-TH')}`, className: 'text-rose-600' }
  const hours = Math.ceil(remaining / 3_600_000)
  const duration = hours < 48 ? `${hours} ชั่วโมง` : `${Math.ceil(hours / 24)} วัน`
  return {
    text: `Cookie เหลือประมาณ ${duration} · หมดอายุ ${expiresAt.toLocaleString('th-TH')}`,
    className: remaining <= 7 * 86_400_000 ? 'text-amber-600' : 'text-slate-400',
  }
}

export default function AccountsPanel() {
  const [accounts, setAccounts] = useState([])
  const [name, setName] = useState('')
  const [pending, setPending] = useState(null)
  const [loginStatus, setLoginStatus] = useState(null)
  const [starting, setStarting] = useState(false)
  const [editing, setEditing] = useState(null)
  const [editingName, setEditingName] = useState('')
  const [error, setError] = useState(null)
  const [checking, setChecking] = useState(false)
  const load = async (refresh = false) => {
    if (refresh) setChecking(true)
    try {
      const data = await getAccounts(refresh)
      setAccounts(data.accounts || [])
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      if (refresh) setChecking(false)
    }
  }
  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(true), 60_000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!pending?.id) return
    let stopped = false
    const check = async () => {
      try {
        const status = await getAccountLoginStatus(pending.id)
        if (!stopped) {
          setLoginStatus(status)
          if (!status.active) {
            setPending(null)
            setError(status.message || 'หน้าต่าง Facebook ถูกปิด กรุณาเริ่มใหม่')
          }
        }
      } catch (e) {
        if (!stopped) setError(e.message)
      }
    }
    void check()
    const timer = setInterval(check, 2000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [pending?.id])

  async function start() {
    setError(null)
    setLoginStatus(null)
    setStarting(true)
    try { setPending(await startAccountLogin(name)); setName('') } catch (e) { setError(e.message) }
    finally { setStarting(false) }
  }
  async function relogin(account) {
    setError(null)
    setLoginStatus(null)
    setStarting(true)
    try { setPending(await restartAccountLogin(account.id, account.name)) }
    catch (e) { setError(e.message) }
    finally { setStarting(false) }
  }
  async function finish() {
    setError(null)
    try {
      await finishAccountLogin(pending.id)
      setPending(null)
      setLoginStatus(null)
      load()
    } catch (e) { setError(e.message) }
  }
  async function cancel() {
    try { await cancelAccountLogin(pending.id) } catch { /* window may already be closed */ }
    setPending(null)
    setLoginStatus(null)
    setError(null)
  }
  async function remove(account) {
    if (!confirm(`ลบบัญชี “${account.name}” ออกจากแอปหรือไม่?`)) return
    try { await deleteAccount(account.id); load() } catch (e) { setError(e.message) }
  }
  function beginRename(account) {
    setEditing(account.id)
    setEditingName(account.name)
    setError(null)
  }
  async function saveRename() {
    try {
      await renameAccount(editing, editingName)
      setEditing(null)
      setEditingName('')
      await load(true)
    } catch (e) { setError(e.message) }
  }

  return <section className="rounded-2xl border border-slate-200 bg-white p-5">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="font-bold text-slate-800">👤 บัญชีสำหรับโพสต์</h2>
        <p className="mt-1 text-sm text-slate-500">สถานะตรวจจาก Facebook จริงและอัปเดตอัตโนมัติทุก 1 นาที</p>
      </div>
      <button onClick={() => load(true)} disabled={checking} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
        {checking ? '● กำลังตรวจ…' : '↻ ตรวจสถานะตอนนี้'}
      </button>
    </div>
    <div className="mt-4 space-y-2">
      {accounts.map((account) => { const expiry = sessionExpiryLabel(account.sessionExpiresAt); return <div key={account.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
        {editing === account.id ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <input autoFocus value={editingName} onChange={(e) => setEditingName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void saveRename(); if (e.key === 'Escape') setEditing(null) }} maxLength={80} className="min-w-0 flex-1 rounded-lg border border-indigo-300 px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-100" />
            <button onClick={saveRename} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white">บันทึก</button>
            <button onClick={() => setEditing(null)} className="rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100">ยกเลิก</button>
          </div>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <b className="block truncate text-sm text-slate-700">{account.name}</b>
              <div className={`text-xs ${account.ready ? 'text-emerald-600' : account.sessionStatus === 'unknown' ? 'text-slate-500' : 'text-amber-600'}`}>
                {account.ready
                  ? '● พร้อมใช้งาน — Facebook ยืนยันแล้ว'
                  : account.sessionStatus === 'expired'
                    ? '● Session หมดอายุ — ล็อกอินใหม่'
                    : account.sessionStatus === 'unknown'
                      ? '● ยังยืนยันสถานะไม่ได้ — กดตรวจอีกครั้ง'
                      : '● ยังไม่มี Session — ล็อกอินใหม่'}
              </div>
              {account.statusReason && <p className="mt-0.5 truncate text-[10px] text-slate-400" title={account.statusReason}>{account.statusReason}</p>}
              <p className={`text-[10px] font-semibold ${expiry.className}`}>{expiry.text}</p>
              {account.lastCheckedAt && <p className="text-[10px] text-slate-400">ตรวจล่าสุด {new Date(account.lastCheckedAt).toLocaleTimeString('th-TH')}</p>}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => relogin(account)} disabled={starting || Boolean(pending)} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">↻ ล็อกอินใหม่</button>
              <button onClick={() => beginRename(account)} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50">✏️ แก้ชื่อ</button>
              {account.id !== 'primary' && <button onClick={() => remove(account)} className="rounded-lg px-2.5 py-1.5 text-xs text-rose-500 hover:bg-rose-50">ลบ</button>}
            </div>
          </>
        )}
      </div>})}
    </div>
    {!pending ? <div className="mt-4 flex gap-2"><input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !starting && start()} placeholder="ชื่อบัญชี เช่น โปรไฟล์สำรอง" disabled={starting} className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50" /><button onClick={start} disabled={starting} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{starting ? 'กำลังเปิด…' : '＋ เพิ่มบัญชี'}</button></div>
      : <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-xl shadow-sm">{pending.qrOpened ? '▦' : '🔐'}</div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-indigo-900">กำลังเพิ่ม “{pending.name}”</p>
            <p className="mt-1 text-xs leading-relaxed text-indigo-700">
              {loginStatus?.message || 'กรุณาล็อกอินในหน้าต่าง Facebook ที่เปิดขึ้น'}
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-slate-600">
              <li>เข้าสู่ระบบด้วยอีเมล/เบอร์โทร และผ่านการยืนยันให้ครบ</li>
              <li>ถ้าใช้โปรไฟล์สำรอง ให้สลับโปรไฟล์ในหน้าต่างนั้นก่อน</li>
              <li>ตรวจชื่อ/รูปมุมขวาบน แล้วจึงกดบันทึกด้านล่าง</li>
            </ol>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${loginStatus?.loggedIn ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            {loginStatus?.loggedIn ? 'พร้อมบันทึก' : 'รอล็อกอิน'}
          </span>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={cancel} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-white">ยกเลิก</button>
          <button onClick={finish} disabled={!loginStatus?.loggedIn} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">✓ บันทึกบัญชีนี้</button>
        </div>
      </div>}
    {error && <div className="mt-3 text-sm text-rose-600">⚠️ {error}</div>}
  </section>
}
