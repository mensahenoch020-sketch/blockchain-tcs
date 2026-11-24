import React from 'react';
import { UploadCloud } from 'lucide-react';

export function Feedback({ text, kind = 'error' }) {
  return text ? <p role={kind === 'error' ? 'alert' : 'status'} className={'feedback ' + kind}>{text}</p> : null;
}

export function FileInput({ required = false }) {
  return <label className="file-field">
    <span><UploadCloud size={22}/> {required ? 'Original certificate PDF' : 'Certificate PDF (optional)'}</span>
    <input name="file" type="file" accept=".pdf,application/pdf" required={required}/>
    <small>PDF only, up to 5 MB</small>
  </label>;
}

export function TxLink({ hash, chainId }) {
  if (!hash) return <span>—</span>;
  return chainId === 11155111
    ? <a className="tx" target="_blank" rel="noreferrer" href={'https://sepolia.etherscan.io/tx/' + hash}>{hash}</a>
    : <code className="tx">{hash}</code>;
}

