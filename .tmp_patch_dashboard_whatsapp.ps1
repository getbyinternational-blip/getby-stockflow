$ErrorActionPreference = 'Stop'

$path = Resolve-Path 'pages/Dashboard.tsx'
$lines = [System.Collections.Generic.List[string]]::new()
(Get-Content $path).ForEach({ [void]$lines.Add($_) })

function Find-LineIndex {
  param(
    [System.Collections.Generic.List[string]]$Source,
    [string]$Exact
  )

  for ($i = 0; $i -lt $Source.Count; $i += 1) {
    if ($Source[$i] -eq $Exact) {
      return $i
    }
  }

  return -1
}

if ((Find-LineIndex $lines "import { shareStatementPdfViaMetaWhatsApp } from '../services/metaWhatsAppShare';") -lt 0) {
  $importIndex = Find-LineIndex $lines "import { buildCustomerStatementRowsFromCanonicalReplay, buildSupplierStatementRowsFromCanonicalLedger } from '../services/ledgerStatements';"
  if ($importIndex -lt 0) { throw 'Missing dashboard ledgerStatements import' }
  $lines.Insert($importIndex + 1, "import { shareStatementPdfViaMetaWhatsApp } from '../services/metaWhatsAppShare';")
}

if ((Find-LineIndex $lines "  const [sendingCustomerStatementId, setSendingCustomerStatementId] = useState<string | null>(null);") -lt 0) {
  $stateIndex = Find-LineIndex $lines "  const [isGeneratingPartyPdf, setIsGeneratingPartyPdf] = useState(false);"
  if ($stateIndex -lt 0) { throw 'Missing dashboard PDF state anchor' }
  $lines.Insert($stateIndex + 1, "  const [sendingCustomerStatementId, setSendingCustomerStatementId] = useState<string | null>(null);")
  $lines.Insert($stateIndex + 2, "  const [sendingPartyStatementId, setSendingPartyStatementId] = useState<string | null>(null);")
}

if ((Find-LineIndex $lines "  const sendCustomerStatementViaWhatsApp = async (customer: Customer) => {") -lt 0) {
  $anchor = Find-LineIndex $lines "  const downloadCustomerStatementPdf = async () => {"
  if ($anchor -lt 0) { throw 'Missing dashboard downloadCustomerStatementPdf anchor' }
  $insert = [string[]]@(
    "  const sendCustomerStatementViaWhatsApp = async (customer: Customer) => {",
    "    try {",
    "      setStatementPdfError(null);",
    "      setSendingCustomerStatementId(customer.id);",
    "      const fileName = ``customer-statement-${customer.name.replace(/\s+/g, '-').toLowerCase()}.pdf``;",
    "      const pdfBlob = await generateCustomerStatementPdfBlob(customer);",
    "      const result = await shareStatementPdfViaMetaWhatsApp({",
    "        phone: customer.phone,",
    "        fileName,",
    "        pdfBlob,",
    "      });",
    "      if (!result.ok) throw new Error(result.message);",
    "      window.alert(``Customer ledger sent to ${customer.phone || customer.name}.``);",
    "    } catch (error) {",
    "      const message = getFriendlyErrorMessage(error, 'Failed to send customer ledger on WhatsApp.');",
    "      setStatementPdfError(message);",
    "      window.alert(message);",
    "    } finally {",
    "      setSendingCustomerStatementId((current) => current === customer.id ? null : current);",
    "    }",
    "  };",
    "",
    "  const sendPartyStatementViaWhatsApp = async (party: PurchaseParty) => {",
    "    try {",
    "      setStatementPdfError(null);",
    "      setSendingPartyStatementId(party.id);",
    "      const fileName = ``party-statement-${party.name.replace(/\s+/g, '-').toLowerCase()}.pdf``;",
    "      const pdfBlob = await generatePartyStatementPdfBlob(party);",
    "      const result = await shareStatementPdfViaMetaWhatsApp({",
    "        phone: party.phone,",
    "        fileName,",
    "        pdfBlob,",
    "      });",
    "      if (!result.ok) throw new Error(result.message);",
    "      window.alert(``Party ledger sent to ${party.phone || party.name}.``);",
    "    } catch (error) {",
    "      const message = getFriendlyErrorMessage(error, 'Failed to send party ledger on WhatsApp.');",
    "      setStatementPdfError(message);",
    "      window.alert(message);",
    "    } finally {",
    "      setSendingPartyStatementId((current) => current === party.id ? null : current);",
    "    }",
    "  };",
    ""
  )
  for ($i = $insert.Length - 1; $i -ge 0; $i -= 1) {
    $lines.Insert($anchor, $insert[$i])
  }
}

if ((Find-LineIndex $lines "                    <Button size=""sm"" variant=""outline"" disabled={sendingCustomerStatementId === c.id} onClick={() => void sendCustomerStatementViaWhatsApp(c)}>{sendingCustomerStatementId === c.id ? 'Sending...' : 'Send Ledger'}</Button>") -lt 0) {
  $rowIndex = Find-LineIndex $lines "                    <Button size=""sm"" variant=""outline"" onClick={() => setStatementCustomerId(c.id)}>View Statement</Button>"
  if ($rowIndex -lt 0) { throw 'Missing dashboard customer row View Statement button' }
  $lines.Insert($rowIndex + 1, "                    <Button size=""sm"" variant=""outline"" disabled={sendingCustomerStatementId === c.id} onClick={() => void sendCustomerStatementViaWhatsApp(c)}>{sendingCustomerStatementId === c.id ? 'Sending...' : 'Send Ledger'}</Button>")
}

if ((Find-LineIndex $lines "                    <Button size=""sm"" variant=""outline"" disabled={sendingPartyStatementId === p.id} onClick={() => void sendPartyStatementViaWhatsApp(p)}>{sendingPartyStatementId === p.id ? 'Sending...' : 'Send Ledger'}</Button>") -lt 0) {
  $rowIndex = Find-LineIndex $lines "                    <Button size=""sm"" variant=""outline"" onClick={() => setStatementPartyId(p.id)}>View Statement</Button>"
  if ($rowIndex -lt 0) { throw 'Missing dashboard party row View Statement button' }
  $lines.Insert($rowIndex + 1, "                    <Button size=""sm"" variant=""outline"" disabled={sendingPartyStatementId === p.id} onClick={() => void sendPartyStatementViaWhatsApp(p)}>{sendingPartyStatementId === p.id ? 'Sending...' : 'Send Ledger'}</Button>")
}

if ((Find-LineIndex $lines "              <Button type=""button"" variant=""outline"" size=""sm"" disabled={sendingCustomerStatementId === selectedCustomer.id} onClick={() => void sendCustomerStatementViaWhatsApp(selectedCustomer)}>") -lt 0) {
  $start = Find-LineIndex $lines '            <div className="flex justify-end">'
  if ($start -lt 0) { throw 'Missing dashboard customer modal action start' }
  $end = $start
  while ($end -lt $lines.Count -and $lines[$end] -ne '            </div>') { $end += 1 }
  if ($end -ge $lines.Count) { throw 'Missing dashboard customer modal action end' }
  $lines.RemoveRange($start, $end - $start + 1)
  $replacement = [string[]]@(
    '            <div className="flex justify-end gap-2">',
    '              <Button type="button" variant="outline" size="sm" disabled={sendingCustomerStatementId === selectedCustomer.id} onClick={() => void sendCustomerStatementViaWhatsApp(selectedCustomer)}>',
    "                {sendingCustomerStatementId === selectedCustomer.id ? 'Sending...' : 'Send Ledger'}",
    '              </Button>',
    '              <Button type="button" variant="outline" size="sm" disabled={isGeneratingCustomerPdf} onClick={() => void downloadCustomerStatementPdf()}>',
    "                {isGeneratingCustomerPdf ? 'Generating PDF...' : 'Download Statement PDF'}",
    '              </Button>',
    '            </div>'
  )
  for ($i = $replacement.Length - 1; $i -ge 0; $i -= 1) {
    $lines.Insert($start, $replacement[$i])
  }
}

if ((Find-LineIndex $lines '          <div className="flex gap-2">') -lt 0) {
  $start = Find-LineIndex $lines '        headerActions={'
  if ($start -lt 0) { throw 'Missing dashboard party headerActions start' }
  $end = $start
  while ($end -lt $lines.Count -and $lines[$end] -ne '        }') { $end += 1 }
  if ($end -ge $lines.Count) { throw 'Missing dashboard party headerActions end' }
  $lines.RemoveRange($start, $end - $start + 1)
  $replacement = [string[]]@(
    '        headerActions={',
    '          <div className="flex gap-2">',
    '            <Button type="button" variant="outline" size="sm" disabled={sendingPartyStatementId === selectedParty?.id} onClick={() => selectedParty && void sendPartyStatementViaWhatsApp(selectedParty)}>',
    "              {sendingPartyStatementId === selectedParty?.id ? 'Sending...' : 'Send Ledger'}",
    '            </Button>',
    '            <Button type="button" variant="outline" size="sm" disabled={isGeneratingPartyPdf} onClick={() => void downloadPartyStatementPdf()}>',
    "              {isGeneratingPartyPdf ? 'Generating PDF...' : 'Download Statement PDF'}",
    '            </Button>',
    '          </div>',
    '        }'
  )
  for ($i = $replacement.Length - 1; $i -ge 0; $i -= 1) {
    $lines.Insert($start, $replacement[$i])
  }
}

[System.IO.File]::WriteAllLines($path, $lines)
Write-Output 'updated-dashboard-ledger-whatsapp'
