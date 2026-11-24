import React, { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { Activity, Building2, CircleCheck, FileText, LayoutDashboard, LogOut, Plus,
  QrCode, RefreshCcw, Shield, Users } from 'lucide-react';
import { request, dateTime } from './client.js';
import { Feedback, FileInput, TxLink } from './components.jsx';

function useData(path, refresh = 0) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true });
    request(path, { signal: controller.signal }).then(data => setState({ data })).catch(error => {
      if (!controller.signal.aborted) setState({ error: error.message });
    });
    return () => controller.abort();
  }, [path, refresh]);
  return state;
}

function DataView({ value, children }) {
  if (value.loading) return <p className="panel" role="status">Loading…</p>;
  if (value.error) return <Feedback text={value.error}/>;
  return children(value.data);
}

function PageTitle({ title, subtitle, action }) {
  return <div className="page-title"><div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>;
}

function Status({ children, tone = 'neutral' }) {
  return <span className={'status ' + tone}>{children}</span>;
}

function Table({ labels, children }) {
  return <div className="table-scroll panel"><table><thead><tr>{labels.map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
    <tbody>{children}</tbody></table></div>;
}

function emptyRow(columns, text) {
  return <tr><td colSpan={columns} className="empty">{text}</td></tr>;
}

function useAction(onSuccess) {
  const [activity, setActivity] = useState({ busy: false });
  async function run(operation, message) {
    setActivity({ busy: true });
    try {
      const result = await operation();
      setActivity({ busy: false, message: typeof message === 'function' ? message(result) : message });
      onSuccess?.(result);
      return true;
    } catch (error) {
      setActivity({ busy: false, error: error.message });
      return false;
    }
  }
  return { ...activity, run };
}

function ActionFeedback({ action }) {
  return <><Feedback text={action.error}/><Feedback text={action.message} kind="neutral"/></>;
}

function Overview({ user }) {
  const stats = useData('/dashboard');
  const admin = user.role === 'admin';
  return <>
    <PageTitle title={admin ? 'Administrator dashboard' : 'Institution dashboard'}
      subtitle={admin ? 'Manage institutions, users and verification activity.' : user.institution}
      action={!admin && stats.data?.approved && <Link className="button" to="issue"><Plus size={18}/> Register certificate</Link>}/>
    <DataView value={stats}>{data => <>
      {!admin && <Feedback kind={data.approved ? 'success' : 'warning'} text={data.approved === null
        ? 'Issuer approval is temporarily unavailable.' : data.approved
          ? 'This institution is approved to register certificates.' : 'This institution is awaiting approval or has been disabled.'}/>}
      <div className="stats-grid">
        {[[FileText, 'Certificate records', data.total], [CircleCheck, 'Confirmed registrations', data.confirmed],
          [RefreshCcw, 'Pending registrations', data.pending],
          ...(admin ? [[Building2, 'Institutions', data.institutions], [Activity, 'Verification checks', data.verifications]] : [])]
          .map(([Icon, title, metric]) => <article className="panel metric" key={title}>
            <span className="icon-tile"><Icon size={20}/></span><span>{title}</span><strong>{metric}</strong>
          </article>)}
      </div>
      <section className="panel network-card"><Shield size={22}/><div>
        <h2>{data.network.chainId === 11155111 ? 'Ethereum Sepolia' : 'Local Hardhat Ethereum'}</h2>
        <p>Registry contract</p><code>{data.network.address}</code>
      </div></section>
    </>}</DataView>
  </>;
}

async function syncRegistration(id, signal) {
  return request('/certificates/' + encodeURIComponent(id) + '/synchronize?check=1', {
    method: 'POST', signal
  });
}

function usePendingSync(ids, onSettled) {
  const queue = ids.join(',');
  useEffect(() => {
    if (!queue) return;
    const controller = new AbortController();
    const pending = queue.split(',');
    const deadline = Date.now() + 5 * 60_000;
    let timer;

    async function poll() {
      try {
        if (document.visibilityState === 'visible') {
          const id = pending.shift();
          const result = await syncRegistration(id, controller.signal).catch(error => {
            if ([401, 403].includes(error.status)) controller.abort();
            return null;
          });
          if (controller.signal.aborted) return;
          if (result && result.state !== 'pending') onSettled(result);
          else pending.push(id);
        }
      } finally {
        if (!controller.signal.aborted && pending.length && Date.now() < deadline) {
          timer = setTimeout(poll, 5000);
        }
      }
    }

    timer = setTimeout(poll, 5000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [queue, onSettled]);
}

function Issue() {
  const [record, setRecord] = useState(null);
  const action = useAction(setRecord);
  usePendingSync(record?.state === 'pending' && record.transaction ? [record.id] : [], setRecord);
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (await action.run(() => request('/certificates', { method: 'POST', body: new FormData(form) }))) form.reset();
  }
  return <>
    <PageTitle title="Register a certificate" subtitle="Use the final PDF that the institution will provide to the graduate."/>
    <form className="panel form form-limit" onSubmit={submit}>
      <label>Certificate ID (optional)<input name="id" maxLength={64} placeholder="Leave blank to generate an ID"/></label>
      <label>Certificate holder<input name="holder" required minLength={2} maxLength={160}/></label>
      <label>Qualification<input name="qualification" required minLength={2} maxLength={160}/></label>
      <FileInput required/><button className="button" disabled={action.busy}>
        <Plus size={19}/>{action.busy ? 'Submitting to Ethereum…' : 'Register on Ethereum'}</button>
      <ActionFeedback action={action}/>
    </form>
    {record && <section className="panel issue-result" aria-live="polite"><h2>{record.state === 'confirmed' ? 'Registration confirmed' : 'Registration ' + record.state}</h2>
      <p>Certificate ID <strong>{record.id}</strong></p>
      {record.transaction && <p>Transaction <TxLink hash={record.transaction} chainId={record.chainId}/></p>}
      {record.state === 'pending' && record.transaction && <p>Sent to Ethereum. This page checks for confirmation automatically.</p>}
      <Link to="/workspace/records">{record.state === 'confirmed' ? 'View record and QR code' : 'Open records to synchronize'}</Link>
    </section>}
  </>;
}

function Records({ user }) {
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [qr, setQr] = useState(null);
  const [revoking, setRevoking] = useState(null);
  const records = useData('/certificates?page=' + page, refresh);
  const action = useAction(() => { setRefresh(value => value + 1); setRevoking(null); });
  const refreshSettled = React.useCallback(() => setRefresh(value => value + 1), []);
  usePendingSync(records.data?.items.filter(row => row.state === 'pending' && row.tx_hash)
    .map(row => row.id) || [], refreshSettled);
  return <>
    <PageTitle title="Certificate records" subtitle="Review registration transactions, verification links and revocation status."
      action={<button className="secondary" onClick={() => setRefresh(value => value + 1)}><RefreshCcw size={17}/> Refresh</button>}/>
    <ActionFeedback action={action}/>
    {revoking && <section className="panel confirm" aria-label="Confirm revocation">
      <h2>Revoke {revoking}?</h2><p>Revocation is permanent and changes the public verification result.</p>
      <div className="actions"><button className="danger-button" disabled={action.busy}
        onClick={() => action.run(() => request('/certificates/' + revoking + '/revoke', { method: 'POST' }),
          result => (result.state === 'confirmed' ? 'Certificate revoked.' : 'Revocation pending. Refresh to check status.') + ' Transaction ' + result.transaction)}>Confirm revocation</button>
        <button className="secondary" disabled={action.busy} onClick={() => setRevoking(null)}>Cancel</button></div>
    </section>}
    {qr && <section className="panel qr-panel" aria-label="Verification QR code">
      <img src={'/api/certificates/' + qr + '/qr'} alt={'Verification QR code for ' + qr} width="160" height="160"/>
      <div><h2>{qr}</h2><p>Scan with a camera or open the verification page.</p>
        <div className="actions"><Link to={'/verify/' + qr}>Open verification</Link>
          <a href={'/api/certificates/' + qr + '/qr'} download={qr + '.png'}>Download QR</a>
          <button className="secondary" onClick={() => setQr(null)}>Close</button></div></div>
    </section>}
    <DataView value={records}>{data => <>
      <Table labels={['Certificate', 'Institution', 'Status', 'Transaction', 'Actions']}>
        {!data.items.length && emptyRow(5, 'No certificates registered yet.')}
        {data.items.map(row => <tr key={row.id}>
          <td><strong>{row.id}</strong><small>{row.holder} · {row.qualification}</small><small>{dateTime(row.created_at)}</small></td>
          <td>{row.institution}</td>
          <td><Status tone={row.status === 'active' ? 'success' : row.status === 'revoked' || row.state === 'failed' ? 'error' : 'warning'}>
            {row.status || (row.state === 'confirmed' ? 'Status unavailable' : row.state)}</Status></td>
          <td><TxLink hash={row.tx_hash} chainId={data.chainId}/></td>
          <td><div className="actions">
            {row.state === 'confirmed' && <button className="small-button" onClick={() => setQr(row.id)}><QrCode size={16}/> QR code</button>}
            {row.state !== 'confirmed' && <button className="small-button" disabled={action.busy}
              onClick={() => action.run(() => request('/certificates/' + row.id + '/synchronize', { method: 'POST' }),
                result => 'Registration ' + result.state + '.')}><RefreshCcw size={16}/> {user.role === 'issuer' ? 'Sync / retry' : 'Sync'}</button>}
            {row.status === 'active' && <button className="small-button danger-text" disabled={action.busy}
              onClick={() => setRevoking(row.id)}>Revoke</button>}
          </div></td>
        </tr>)}
      </Table>
      {(page > 1 || data.more) && <div className="actions pager">
        <button className="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span>Page {page}</span><button className="secondary" disabled={!data.more} onClick={() => setPage(page + 1)}>Next</button>
      </div>}
    </>}</DataView>
  </>;
}

function Institutions() {
  const [refresh, setRefresh] = useState(0);
  const data = useData('/admin/institutions', refresh);
  const action = useAction(() => setRefresh(value => value + 1));
  async function add(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (await action.run(() => request('/admin/institutions', {
      method: 'POST', body: Object.fromEntries(new FormData(form))
    }), 'Institution added. Approve it to enable issuance.')) form.reset();
  }
  return <>
    <PageTitle title="Institutions" subtitle="Register issuing institutions and manage which wallets can issue on Ethereum."
      action={<button className="secondary" onClick={() => setRefresh(value => value + 1)}><RefreshCcw size={17}/> Refresh</button>}/>
    <ActionFeedback action={action}/>
    <DataView value={data}>{({ institutions, wallets }) => <>
      <form className="panel form admin-form" onSubmit={add}>
        <label>Institution name<input name="name" required minLength={2} maxLength={160}/></label>
        <label>Issuer wallet<input name="wallet" list="configured-wallets" placeholder="0x…" required pattern="0x[a-fA-F0-9]{40}"/></label>
        <datalist id="configured-wallets">{wallets.map(wallet => <option key={wallet} value={wallet}/>)}</datalist>
        <button className="button" disabled={action.busy}><Plus size={17}/> Add institution</button>
      </form>
      <Table labels={['Institution', 'Issuer wallet', 'Approval', 'Action']}>
        {!institutions.length && emptyRow(4, 'No institutions registered.')}
        {institutions.map(row => <tr key={row.id}><td><strong>{row.name}</strong></td><td><code className="tx">{row.wallet}</code></td>
          <td><Status tone={row.approved ? 'success' : 'warning'}>{row.approved === null ? 'Unavailable' : row.approved ? 'Approved' : 'Unapproved'}</Status></td>
          <td><button className="small-button" disabled={row.approved === null || action.busy}
            onClick={() => action.run(() => request('/admin/institutions/' + row.id, {
              method: 'PATCH', body: { enabled: !row.approved }
            }), result => (result.state === 'pending' ? 'Approval change pending. Refresh this page to check status.' : result.approved ? 'Institution approved.' : 'Institution disabled.') + ' Transaction ' + result.transaction)}>
            {row.approved ? 'Disable' : 'Approve'}</button></td>
        </tr>)}
      </Table>
    </>}</DataView>
  </>;
}

function Accounts({ user }) {
  const [refresh, setRefresh] = useState(0);
  const [role, setRole] = useState('issuer');
  const data = useData('/admin/users', refresh);
  const institutions = useData('/admin/institutions');
  const action = useAction(() => setRefresh(value => value + 1));
  async function add(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (await action.run(() => request('/admin/users', {
      method: 'POST', body: Object.fromEntries(new FormData(form))
    }), 'Account created.')) form.reset();
  }
  return <>
    <PageTitle title="User accounts" subtitle="Create staff accounts and control their access to the platform."/>
    <ActionFeedback action={action}/>
    <form className="panel form admin-form users-form" onSubmit={add}>
      <label>Email<input name="email" required type="email"/></label>
      <label>Initial password<input name="password" required type="password" minLength={12} maxLength={128}
        autoComplete="new-password"/></label>
      <label>Role<select value={role} name="role" onChange={e => setRole(e.target.value)}>
        <option value="issuer">Institution officer</option><option value="admin">Administrator</option>
      </select></label>
      {role === 'issuer' && <label>Institution<select name="institution" aria-label="Institution" required defaultValue="">
        <option value="" disabled>Select institution</option>
        {institutions.data?.institutions.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select></label>}
      <button className="button" disabled={action.busy}><Plus size={17}/> Create account</button>
    </form>
    <Feedback text={institutions.error}/>
    <DataView value={data}>{rows => <Table labels={['Email', 'Role', 'Institution', 'Access', 'Action']}>
      {rows.map(row => <tr key={row.id}><td><strong>{row.email}</strong></td><td>{row.role === 'admin' ? 'Administrator' : 'Institution officer'}</td>
        <td>{row.institution || '—'}</td><td><Status tone={row.enabled ? 'success' : 'warning'}>{row.enabled ? 'Enabled' : 'Disabled'}</Status></td>
        <td>{row.id === user.id ? 'Current account' : <button className="small-button" disabled={action.busy}
          onClick={() => action.run(() => request('/admin/users/' + row.id, { method: 'PATCH', body: { enabled: !row.enabled } }),
            row.enabled ? 'Account disabled.' : 'Account enabled.')}>{row.enabled ? 'Disable' : 'Enable'}</button>}</td>
      </tr>)}
    </Table>}</DataView>
  </>;
}

function Audit() {
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState('all');
  const data = useData('/admin/activity', refresh);
  return <>
    <PageTitle title="Activity log" subtitle="Review the latest 200 recorded actions, including public verification checks."
      action={<button className="secondary" onClick={() => setRefresh(value => value + 1)}><RefreshCcw size={17}/> Refresh</button>}/>
    <label className="filter">Show<select value={filter} onChange={event => setFilter(event.target.value)}>
      <option value="all">All activity</option><option value="verification">Verification checks</option><option value="staff">Staff activity</option>
    </select></label>
    <DataView value={data}>{rows => {
      const filtered = rows.filter(row => filter === 'all' || (row.action === 'certificate.verified') === (filter === 'verification'));
      return <Table labels={['Time', 'Event', 'Actor', 'Record', 'Detail']}>
        {!filtered.length && emptyRow(5, 'No matching activity.')}
        {filtered.map(row => <tr key={row.id}><td>{dateTime(row.created_at)}</td>
          <td><strong>{row.action.replaceAll('.', ' ')}</strong></td><td>{row.actor || 'Public verifier'}</td>
          <td>{row.subject || '—'}</td><td><span className="tx">{row.detail || '—'}</span></td></tr>)}
      </Table>;
    }}</DataView>
  </>;
}

export function Workspace({ user, onLogout }) {
  const admin = user.role === 'admin';
  const navigate = useNavigate();
  const action = useAction(() => { onLogout(); navigate('/login'); });
  const links = [
    ['', 'Overview', LayoutDashboard], ['records', 'Certificates', FileText],
    ...(admin ? [['institutions', 'Institutions', Building2], ['users', 'Users', Users], ['activity', 'Activity', Activity]]
      : [['issue', 'Register certificate', Plus]])
  ];
  return <div className="wrap workspace">
    <aside className="sidebar"><div className="sidebar-title"><Shield size={19}/>{admin ? 'Administration' : 'Institution'}</div>
      <nav aria-label="Workspace navigation">{links.map(([path, title, Icon]) =>
        <NavLink key={path} end={!path} to={'/workspace' + (path ? '/' + path : '')}><Icon size={17}/>{title}</NavLink>)}</nav>
      <div className="sidebar-account"><small>{user.email}</small><button className="small-button" disabled={action.busy}
        onClick={() => action.run(() => request('/auth/logout', { method: 'POST' }))}><LogOut size={17}/> Sign out</button></div>
    </aside>
    <section className="workspace-content"><ActionFeedback action={action}/><Routes>
      <Route index element={<Overview user={user}/>}/>
      <Route path="records" element={<Records user={user}/>}/>
      {admin ? <>
        <Route path="institutions" element={<Institutions/>}/><Route path="users" element={<Accounts user={user}/>}/>
        <Route path="activity" element={<Audit/>}/>
      </> : <Route path="issue" element={<Issue/>}/>}
      <Route path="*" element={<PageTitle title="Workspace page not found" subtitle="Choose a page from the workspace navigation."/>}/>
    </Routes></section>
  </div>;
}
