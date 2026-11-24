import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, BadgeCheck, Building2, FileCheck2, Fingerprint, GraduationCap, LockKeyhole,
  SearchCheck, ShieldCheck } from 'lucide-react';
import { request, dateTime } from './client.js';
import { Workspace } from './workspace.jsx';
import { Feedback, FileInput, TxLink } from './components.jsx';
import './style.css';

function Brand() {
  return <Link className="brand" to="/"><span className="brand-icon"><GraduationCap size={23}/></span>
    <span>Credential Registry<small>Academic verification</small></span></Link>;
}

function Frame({ user, children }) {
  return <div className="shell">
    <header><div className="wrap topbar"><Brand/><nav aria-label="Main navigation">
      <NavLink to="/" end>Home</NavLink><NavLink to="/verify">Verify</NavLink>
      <NavLink className="top-action" to={user ? '/workspace' : '/login'}>{user ? 'Workspace' : 'Staff sign in'}</NavLink>
    </nav></div></header>
    <main>{children}</main>
    <footer><div className="wrap foot"><Brand/><span>Academic certificate verification and tamper detection</span>
      <Link to="/verify">Verify a certificate <ArrowRight size={15}/></Link></div></footer>
  </div>;
}

function Home() {
  return <>
    <section className="hero"><div className="wrap hero-grid">
      <div><div className="eyebrow"><ShieldCheck size={17}/> Academic credential verification</div>
        <h1>Verify academic<br className="desktop"/> certificates <em>online.</em></h1>
        <p>Check whether a certificate was registered by an approved institution. Upload the original PDF to see whether it matches the SHA-256 fingerprint recorded on Ethereum.</p>
        <div className="hero-actions"><Link className="button" to="/verify">Verify a certificate <ArrowRight size={19}/></Link>
          <Link className="secondary" to="/login">Institution and admin sign in</Link></div>
      </div>
      <div className="hero-illustration" aria-hidden="true">
        <div className="orbit orbit-outer"/><div className="orbit orbit-inner"/>
        <div className="certificate-art"><div className="art-icon"><GraduationCap size={32}/></div>
          <span>ACADEMIC CERTIFICATE</span><i/><i/><i/><div className="art-line"/>
          <div className="art-signature"/><div className="art-seal"><BadgeCheck size={38}/></div></div>
        <div className="art-chip"><Fingerprint size={21}/> SHA-256</div>
        <div className="art-check"><ShieldCheck size={34}/></div>
      </div>
    </div></section>
    <section className="wrap intro-section">
      <div className="eyebrow light">How verification works</div><h2>From issuance to verification</h2>
      <div className="how-grid">
        {[[Building2, 'Institution registration', 'An approved institution registers the original document’s fingerprint on Ethereum.'],
          [SearchCheck, 'Certificate lookup', 'Enter the certificate ID or open its QR link to check the issuer and registration status.'],
          [FileCheck2, 'File integrity check', 'Upload the original PDF to compare its exact bytes with the registered fingerprint.']]
          .map(([Icon, title, copy]) => <article className="how-card" key={title}><span className="icon-tile"><Icon size={23}/></span>
            <h3>{title}</h3><p>{copy}</p></article>)}
      </div>
    </section>
  </>;
}

const outcome = {
  match: ['Verified File Match', 'The uploaded PDF matches the fingerprint registered on Ethereum. The certificate is active and the issuer is approved.', 'success'],
  registered: ['Registered · Active', 'The certificate ID is registered. Upload a PDF to check whether the file matches the original.', 'neutral'],
  mismatch: ['Document Mismatch', 'The uploaded file differs from the registered PDF. Rescanning or saving the document in a different format can change its fingerprint.', 'warning'],
  revoked: ['Revoked', 'The certificate is no longer active.', 'error'],
  not_found: ['Not Found', 'No certificate with this ID was found on the configured blockchain. Check the characters and try again.', 'warning'],
  unavailable: ['Unable to Verify', 'The service could not reach a reliable result. Try again shortly.', 'error'],
  issuer_disabled: ['Issuer Disabled', 'This certificate is registered, but its issuer is currently disabled.', 'warning']
};

function Result({ result }) {
  const [heading, detail, tone] = outcome[result.status];
  return <section className={'result panel ' + tone} aria-live="polite">
    <div className="result-heading"><span className="icon-tile"><FileCheck2 size={25}/></span><h2>{heading}</h2></div>
    <p>{detail}</p>
    <dl><dt>Certificate ID</dt><dd>{result.id}</dd>
      {result.institution && <><dt>Issuing institution</dt><dd>{result.institution}</dd></>}
      {result.registeredAt && <><dt>Registered</dt><dd>{dateTime(result.registeredAt)}</dd>
        <dt>Network</dt><dd>{result.chainId === 11155111 ? 'Ethereum Sepolia' : 'Local Ethereum'}</dd></>}
      {result.transaction && <><dt>Registration transaction</dt><dd><TxLink hash={result.transaction} chainId={result.chainId}/></dd></>}
    </dl>
  </section>;
}

function Verify() {
  const { id } = useParams();
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(Boolean(id));
  useEffect(() => {
    setResult(null);
    setError('');
    if (!id) { setBusy(false); return; }
    const controller = new AbortController();
    setBusy(true);
    request('/verify', { method: 'POST', body: { id }, signal: controller.signal })
      .then(setResult).catch(error => {
        if (!controller.signal.aborted) {
          if (!error.status || error.status >= 500) setResult({ id, status: 'unavailable' });
          else setError(error.message);
        }
      })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [id]);

  async function check(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setResult(null);
    const data = new FormData(event.currentTarget);
    if (!data.get('file')?.size && !data.get('file')?.name) data.delete('file');
    try { setResult(await request('/verify', { method: 'POST', body: data })); }
    catch (error) {
      if (!error.status || error.status >= 500) setResult({ id: String(data.get('id')).trim(), status: 'unavailable' });
      else setError(error.message);
    } finally { setBusy(false); }
  }
  return <section className="wrap page narrow">
    <div className="eyebrow light"><ShieldCheck size={17}/> Public verification</div>
    <h1>Verify a certificate</h1><p className="lede">Enter a certificate ID to check its registration. Add the original PDF to check the file itself.</p>
    <form className="panel form" onSubmit={check} key={id || 'lookup'}>
      <label>Certificate ID<input name="id" placeholder="e.g. TCS-DEMO-001" defaultValue={id || ''} maxLength={64} required/></label>
      <FileInput/><button className="button" disabled={busy}><SearchCheck size={19}/>{busy ? 'Checking…' : 'Check certificate'}</button>
      <Feedback text={error}/>
    </form>
    {result && <Result result={result}/>}
  </section>;
}

function Login({ user, onUser }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  if (user) return <Navigate to="/workspace" replace/>;
  async function login(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const credentials = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await request('/auth/login', { method: 'POST', body: credentials });
      onUser(await request('/auth/me'));
      navigate('/workspace', { replace: true });
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <section className="wrap page narrow login-page">
    <span className="icon-tile"><LockKeyhole size={23}/></span><h1>Staff sign in</h1>
    <p className="lede">Sign in with your institution officer or administrator account.</p>
    <form className="panel form" onSubmit={login}>
      <label>Email address<input name="email" autoComplete="username" type="email" required/></label>
      <label>Password<input name="password" autoComplete="current-password" type="password" required maxLength={128}/></label>
      <button className="button" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={19}/></button>
      <Feedback text={error}/>
    </form>
    <p className="help-line">Checking a certificate? <Link to="/verify">Go to public verification</Link></p>
  </section>;
}

function App() {
  const [user, setUser] = useState(undefined);
  useEffect(() => {
    const controller = new AbortController();
    request('/auth/me', { signal: controller.signal }).then(setUser).catch(() => {
      if (!controller.signal.aborted) setUser(null);
    });
    return () => controller.abort();
  }, []);
  return <Frame user={user}><Routes>
    <Route path="/" element={<Home/>}/>
    <Route path="/verify/:id?" element={<Verify/>}/>
    <Route path="/login" element={<Login user={user} onUser={setUser}/>}/>
    <Route path="/workspace/*" element={user === undefined ? <p className="wrap page" role="status">Loading workspace…</p> :
      user ? <Workspace user={user} onLogout={() => setUser(null)}/> : <Navigate to="/login" replace/>}/>
    <Route path="*" element={<section className="wrap page"><h1>Page not found</h1><Link to="/">Return home</Link></section>}/>
  </Routes></Frame>;
}

createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);
