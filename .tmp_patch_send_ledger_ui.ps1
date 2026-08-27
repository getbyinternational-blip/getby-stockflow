$ErrorActionPreference = 'Stop'
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Replace-Exact {
  param(
    [string]$Content,
    [string]$Old,
    [string]$New,
    [string]$Label
  )

  if (-not $Content.Contains($Old)) {
    throw "Missing block: $Label"
  }

  return $Content.Replace($Old, $New)
}

function Update-File {
  param(
    [string]$Path,
    [scriptblock]$Mutator
  )

  $raw = [System.IO.File]::ReadAllText((Resolve-Path $Path), $utf8NoBom)
  $newline = if ($raw.Contains("`r`n")) { "`r`n" } else { "`n" }
  $normalized = $raw.Replace("`r`n", "`n")
  $updated = & $Mutator $normalized
  [System.IO.File]::WriteAllText((Resolve-Path $Path), $updated.Replace("`n", $newline), $utf8NoBom)
}

Update-File 'pages/Dashboard.tsx' {
  param($content)

  $content = Replace-Exact $content @'
import { buildCustomerStatementRowsFromCanonicalReplay, buildSupplierStatementRowsFromCanonicalLedger } from '../services/ledgerStatements';
import { CanonicalCustomerBalanceResult, getCanonicalCustomerBalanceResult } from '../services/customerBalanceView';
'@ @'
import { buildCustomerStatementRowsFromCanonicalReplay, buildSupplierStatementRowsFromCanonicalLedger } from '../services/ledgerStatements';
import { shareStatementPdfViaMetaWhatsApp } from '../services/metaWhatsAppShare';
import { CanonicalCustomerBalanceResult, getCanonicalCustomerBalanceResult } from '../services/customerBalanceView';
'@ 'dashboard import'

  $content = Replace-Exact $content @'
  const [isGeneratingCustomerPdf, setIsGeneratingCustomerPdf] = useState(false);
  const [isGeneratingPartyPdf, setIsGeneratingPartyPdf] = useState(false);
  const [statementPdfError, setStatementPdfError] = useState<string | null>(null);
'@ @'
  const [isGeneratingCustomerPdf, setIsGeneratingCustomerPdf] = useState(false);
  const [isGeneratingPartyPdf, setIsGeneratingPartyPdf] = useState(false);
  const [sendingCustomerStatementId, setSendingCustomerStatementId] = useState<string | null>(null);
  const [sendingPartyStatementId, setSendingPartyStatementId] = useState<string | null>(null);
  const [statementPdfError, setStatementPdfError] = useState<string | null>(null);
'@ 'dashboard state'

  $content = Replace-Exact $content @'
  const generatePartyStatementPdfBlob = async (party: PurchaseParty) => {
    const statement = buildSupplierStatementRowsFromCanonicalLedger(
      party,
      orders,
      supplierPayments,
      partyCreditLedger,
      getDashboardMergedPartyIds(party as PartyPayableRow),
    );
    const profile = loadData().profile;
    const blob = await generateLedgerStatementPDF({
      profile,
      ...statement,
      fileName: `party-statement-${party.name.replace(/\s+/g, '-').toLowerCase()}.pdf`,
      returnBlob: true,
    });
    return blob instanceof Blob ? blob : null;
  };

  const downloadCustomerStatementPdf = async () => {
'@ @'
  const generatePartyStatementPdfBlob = async (party: PurchaseParty) => {
    const statement = buildSupplierStatementRowsFromCanonicalLedger(
      party,
      orders,
      supplierPayments,
      partyCreditLedger,
      getDashboardMergedPartyIds(party as PartyPayableRow),
    );
    const profile = loadData().profile;
    const blob = await generateLedgerStatementPDF({
      profile,
      ...statement,
      fileName: `party-statement-${party.name.replace(/\s+/g, '-').toLowerCase()}.pdf`,
      returnBlob: true,
    });
    return blob instanceof Blob ? blob : null;
  };

  const sendCustomerStatementViaWhatsApp = async (customer: Customer) => {
    try {
      setStatementPdfError(null);
      setSendingCustomerStatementId(customer.id);
      const fileName = `customer-statement-${customer.name.replace(/\s+/g, '-').toLowerCase()}.pdf`;
      const pdfBlob = await generateCustomerStatementPdfBlob(customer);
      const result = await shareStatementPdfViaMetaWhatsApp({
        phone: customer.phone,
        fileName,
        pdfBlob,
      });
      if (!result.ok) throw new Error(result.message);
      window.alert(`Customer ledger sent to ${customer.phone || customer.name}.`);
    } catch (error) {
      const message = getFriendlyErrorMessage(error, 'Failed to send customer ledger on WhatsApp.');
      setStatementPdfError(message);
      window.alert(message);
    } finally {
      setSendingCustomerStatementId((current) => current === customer.id ? null : current);
    }
  };

  const sendPartyStatementViaWhatsApp = async (party: PurchaseParty) => {
    try {
      setStatementPdfError(null);
      setSendingPartyStatementId(party.id);
      const fileName = `party-statement-${party.name.replace(/\s+/g, '-').toLowerCase()}.pdf`;
      const pdfBlob = await generatePartyStatementPdfBlob(party);
      const result = await shareStatementPdfViaMetaWhatsApp({
        phone: party.phone,
        fileName,
        pdfBlob,
      });
      if (!result.ok) throw new Error(result.message);
      window.alert(`Party ledger sent to ${party.phone || party.name}.`);
    } catch (error) {
      const message = getFriendlyErrorMessage(error, 'Failed to send party ledger on WhatsApp.');
      setStatementPdfError(message);
      window.alert(message);
    } finally {
      setSendingPartyStatementId((current) => current === party.id ? null : current);
    }
  };

  const downloadCustomerStatementPdf = async () => {
'@ 'dashboard send helpers'

  $content = Replace-Exact $content @'
                    <Button size="sm" variant="outline" onClick={() => setStatementCustomerId(c.id)}>View Statement</Button>
                    {customerDashboardTab === 'receivable' && <Button size="sm" onClick={() => openReceiveModal(c)}>Receive</Button>}
'@ @'
                    <Button size="sm" variant="outline" onClick={() => setStatementCustomerId(c.id)}>View Statement</Button>
                    <Button size="sm" variant="outline" disabled={sendingCustomerStatementId === c.id} onClick={() => void sendCustomerStatementViaWhatsApp(c)}>{sendingCustomerStatementId === c.id ? 'Sending...' : 'Send Ledger'}</Button>
                    {customerDashboardTab === 'receivable' && <Button size="sm" onClick={() => openReceiveModal(c)}>Receive</Button>}
'@ 'dashboard customer row action'

  $content = Replace-Exact $content @'
                    <Button size="sm" variant="outline" onClick={() => setStatementPartyId(p.id)}>View Statement</Button>
                    {supplierDashboardTab === 'payable' && <Button size="sm" variant="outline" onClick={() => openPayModal(p)}>{Math.max(0, Number(p.payable || 0)) > 0 ? 'Pay' : 'View'}</Button>}
'@ @'
                    <Button size="sm" variant="outline" onClick={() => setStatementPartyId(p.id)}>View Statement</Button>
                    <Button size="sm" variant="outline" disabled={sendingPartyStatementId === p.id} onClick={() => void sendPartyStatementViaWhatsApp(p)}>{sendingPartyStatementId === p.id ? 'Sending...' : 'Send Ledger'}</Button>
                    {supplierDashboardTab === 'payable' && <Button size="sm" variant="outline" onClick={() => openPayModal(p)}>{Math.max(0, Number(p.payable || 0)) > 0 ? 'Pay' : 'View'}</Button>}
'@ 'dashboard party row action'

  $content = Replace-Exact $content @'
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" disabled={isGeneratingCustomerPdf} onClick={() => void downloadCustomerStatementPdf()}>
                {isGeneratingCustomerPdf ? 'Generating PDF...' : 'Download Statement PDF'}
              </Button>
            </div>
'@ @'
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" disabled={sendingCustomerStatementId === selectedCustomer.id} onClick={() => void sendCustomerStatementViaWhatsApp(selectedCustomer)}>
                {sendingCustomerStatementId === selectedCustomer.id ? 'Sending...' : 'Send Ledger'}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={isGeneratingCustomerPdf} onClick={() => void downloadCustomerStatementPdf()}>
                {isGeneratingCustomerPdf ? 'Generating PDF...' : 'Download Statement PDF'}
              </Button>
            </div>
'@ 'dashboard customer modal action'

  $content = Replace-Exact $content @'
        headerActions={
          <Button type="button" variant="outline" size="sm" disabled={isGeneratingPartyPdf} onClick={() => void downloadPartyStatementPdf()}>
            {isGeneratingPartyPdf ? 'Generating PDF...' : 'Download Statement PDF'}
          </Button>
        }
'@ @'
        headerActions={
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={sendingPartyStatementId === selectedParty?.id} onClick={() => selectedParty && void sendPartyStatementViaWhatsApp(selectedParty)}>
              {sendingPartyStatementId === selectedParty?.id ? 'Sending...' : 'Send Ledger'}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={isGeneratingPartyPdf} onClick={() => void downloadPartyStatementPdf()}>
              {isGeneratingPartyPdf ? 'Generating PDF...' : 'Download Statement PDF'}
            </Button>
          </div>
        }
'@ 'dashboard party modal action'

  return $content
}

Update-File 'pages/Customers.tsx' {
  param($content)

  $content = Replace-Exact $content @'
import { buildCustomerStatementRowsFromCanonicalReplay } from '../services/ledgerStatements';
import { auth } from '../services/firebase';
'@ @'
import { buildCustomerStatementRowsFromCanonicalReplay } from '../services/ledgerStatements';
import { shareStatementPdfViaMetaWhatsApp } from '../services/metaWhatsAppShare';
import { auth } from '../services/firebase';
'@ 'customers import'

  $content = Replace-Exact $content @'
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportType, setExportType] = useState<'statement' | 'dues_report' | 'invoice'>('statement');
  const [txToExport, setTxToExport] = useState<Transaction | null>(null);
'@ @'
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportType, setExportType] = useState<'statement' | 'dues_report' | 'invoice'>('statement');
  const [sendingCustomerLedgerId, setSendingCustomerLedgerId] = useState<string | null>(null);
  const [txToExport, setTxToExport] = useState<Transaction | null>(null);
'@ 'customers state'

  $content = Replace-Exact $content @'
  const generateStatementPDF = async () => {
      if (!viewingCustomer) return;
      const statement = buildCustomerStatementRowsFromCanonicalReplay(viewingCustomer, transactions, upfrontOrders);
      await generateLedgerStatementPDF({
        profile: loadData().profile,
        ...statement,
        fileName: `Statement_${viewingCustomer.name.replace(/\s+/g, '_')}.pdf`,
      });
  };

  const generateAllCustomersPDF = () => {
'@ @'
  const generateStatementPDF = async () => {
      if (!viewingCustomer) return;
      const statement = buildCustomerStatementRowsFromCanonicalReplay(viewingCustomer, transactions, upfrontOrders);
      await generateLedgerStatementPDF({
        profile: loadData().profile,
        ...statement,
        fileName: `Statement_${viewingCustomer.name.replace(/\s+/g, '_')}.pdf`,
      });
  };

  const sendCustomerLedgerViaWhatsApp = async (customer: Customer) => {
      try {
          setSendingCustomerLedgerId(customer.id);
          const statement = buildCustomerStatementRowsFromCanonicalReplay(customer, transactions, upfrontOrders);
          const fileName = `Statement_${customer.name.replace(/\s+/g, '_')}.pdf`;
          const pdfBlob = await generateLedgerStatementPDF({
              profile: loadData().profile,
              ...statement,
              fileName,
              returnBlob: true,
          });
          const result = await shareStatementPdfViaMetaWhatsApp({
              phone: customer.phone,
              fileName,
              pdfBlob: pdfBlob instanceof Blob ? pdfBlob : null,
          });
          if (!result.ok) throw new Error(result.message);
          window.alert(`Customer ledger sent to ${customer.phone || customer.name}.`);
      } catch (error) {
          window.alert(getFriendlyErrorMessage(error, 'Failed to send customer ledger on WhatsApp.'));
      } finally {
          setSendingCustomerLedgerId((current) => current === customer.id ? null : current);
      }
  };

  const generateAllCustomersPDF = () => {
'@ 'customers send helper'

  $content = Replace-Exact $content @'
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 w-9 px-0"
                      title="Edit"
                      aria-label={`Edit ${customer.name}`}
                      onClick={() => openCustomerEditor(customer)}
                    >
'@ @'
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 px-2"
                      title="Send Ledger"
                      aria-label={`Send ledger for ${customer.name}`}
                      disabled={sendingCustomerLedgerId === customer.id}
                      onClick={() => void sendCustomerLedgerViaWhatsApp(customer)}
                    >
                      {sendingCustomerLedgerId === customer.id ? '...' : 'WA'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 w-9 px-0"
                      title="Edit"
                      aria-label={`Edit ${customer.name}`}
                      onClick={() => openCustomerEditor(customer)}
                    >
'@ 'customers row action'

  $content = Replace-Exact $content @'
                              <Button size="sm" variant="outline" onClick={() => { setExportType('statement'); setIsExportModalOpen(true); }}><FileText className="mr-1.5 h-4 w-4" /> Statement</Button>
'@ @'
                              <Button size="sm" variant="outline" disabled={sendingCustomerLedgerId === viewingCustomer?.id} onClick={() => viewingCustomer && void sendCustomerLedgerViaWhatsApp(viewingCustomer)}>{sendingCustomerLedgerId === viewingCustomer?.id ? 'Sending...' : 'Send Ledger'}</Button>
                              <Button size="sm" variant="outline" onClick={() => { setExportType('statement'); setIsExportModalOpen(true); }}><FileText className="mr-1.5 h-4 w-4" /> Statement</Button>
'@ 'customers detail action'

  return $content
}

Update-File 'pages/PurchasePanel.tsx' {
  param($content)

  $content = Replace-Exact $content @'
import { getPaymentStatusColorClass } from '../utils_paymentStatusStyles';
import { buildPurchasePartyLedger } from '../services/purchaseLedger';
import {
'@ @'
import { getPaymentStatusColorClass } from '../utils_paymentStatusStyles';
import { buildPurchasePartyLedger } from '../services/purchaseLedger';
import { generateLedgerStatementPDF } from '../services/pdf';
import { buildSupplierStatementRowsFromCanonicalLedger } from '../services/ledgerStatements';
import { shareStatementPdfViaMetaWhatsApp } from '../services/metaWhatsAppShare';
import {
'@ 'purchase import'

  $content = Replace-Exact $content @'
  const [partyPaymentError, setPartyPaymentError] = useState<string | null>(null);
  const [deletePartyError, setDeletePartyError] = useState<string | null>(null);
  const [expandedPartyId, setExpandedPartyId] = useState<string | null>(null);
  const [repairPartyDetailTab, setRepairPartyDetailTab] = useState<'overview' | 'ledger' | 'repair_history'>('overview');
'@ @'
  const [partyPaymentError, setPartyPaymentError] = useState<string | null>(null);
  const [deletePartyError, setDeletePartyError] = useState<string | null>(null);
  const [expandedPartyId, setExpandedPartyId] = useState<string | null>(null);
  const [sendingPartyLedgerId, setSendingPartyLedgerId] = useState<string | null>(null);
  const [repairPartyDetailTab, setRepairPartyDetailTab] = useState<'overview' | 'ledger' | 'repair_history'>('overview');
'@ 'purchase state'

  $content = Replace-Exact $content @'
  const isPurchaseLedgerDebugEnabled = useMemo(() => {
'@ @'
  const sendPartyLedgerViaWhatsApp = async (party: PurchaseParty) => {
    try {
      setPartyPaymentError(null);
      setSendingPartyLedgerId(party.id);
      const fileName = `party-statement-${party.name.replace(/\s+/g, '-').toLowerCase()}.pdf`;
      const statement = buildSupplierStatementRowsFromCanonicalLedger(
        party,
        orders,
        supplierPayments,
        partyCreditLedger,
        getRelatedPartyIds(party.id),
      );
      const pdfBlob = await generateLedgerStatementPDF({
        profile: loadData().profile,
        ...statement,
        fileName,
        returnBlob: true,
      });
      const result = await shareStatementPdfViaMetaWhatsApp({
        phone: party.phone,
        fileName,
        pdfBlob: pdfBlob instanceof Blob ? pdfBlob : null,
      });
      if (!result.ok) throw new Error(result.message);
      window.alert(`Party ledger sent to ${party.phone || party.name}.`);
    } catch (error) {
      const message = getFriendlyErrorMessage(error, 'Failed to send party ledger on WhatsApp.');
      setPartyPaymentError(message);
      window.alert(message);
    } finally {
      setSendingPartyLedgerId((current) => current === party.id ? null : current);
    }
  };

  const isPurchaseLedgerDebugEnabled = useMemo(() => {
'@ 'purchase send helper'

  $content = Replace-Exact $content @'
                          <td className="p-3 text-right">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setExpandedPartyId(party.id);
                                setRepairPartyDetailTab('overview');
                              }}
                            >
                              View Details
                            </Button>
                          </td>
'@ @'
                          <td className="p-3 text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={sendingPartyLedgerId === party.id}
                                onClick={() => void sendPartyLedgerViaWhatsApp(party)}
                              >
                                {sendingPartyLedgerId === party.id ? 'Sending...' : 'Send Ledger'}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setExpandedPartyId(party.id);
                                  setRepairPartyDetailTab('overview');
                                }}
                              >
                                View Details
                              </Button>
                            </div>
                          </td>
'@ 'purchase table action'

  $content = Replace-Exact $content @'
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={() => openCreateOrderForParty(selectedRepairParty)}>Add Purchase</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => openPartyPaymentModal(selectedRepairParty)}>Add Payment</Button>
                </div>
'@ @'
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={() => openCreateOrderForParty(selectedRepairParty)}>Add Purchase</Button>
                  <Button type="button" size="sm" variant="outline" disabled={sendingPartyLedgerId === selectedRepairParty.id} onClick={() => void sendPartyLedgerViaWhatsApp(selectedRepairParty)}>{sendingPartyLedgerId === selectedRepairParty.id ? 'Sending...' : 'Send Ledger'}</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => openPartyPaymentModal(selectedRepairParty)}>Add Payment</Button>
                </div>
'@ 'purchase modal action'

  $content = Replace-Exact $content @'
                      <Button type="button" variant="outline" size="sm" onClick={() => startEditingParty(p, true)} className="h-8 px-2 text-xs" disabled={isHistoricalOnlyParty(p)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>
'@ @'
                      <Button type="button" variant="outline" size="sm" onClick={() => void sendPartyLedgerViaWhatsApp(p)} className="h-8 px-2 text-xs" disabled={isHistoricalOnlyParty(p) || sendingPartyLedgerId === p.id}>{sendingPartyLedgerId === p.id ? 'Sending...' : 'Send Ledger'}</Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => startEditingParty(p, true)} className="h-8 px-2 text-xs" disabled={isHistoricalOnlyParty(p)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>
'@ 'purchase card action'

  return $content
}

Write-Output 'patched-send-ledger-ui'
