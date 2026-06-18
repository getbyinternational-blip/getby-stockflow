import React from 'react';
import LegalPageLayout from './LegalPageLayout';

export default function Terms() {
  return (
    <LegalPageLayout
      title="Terms of Service"
      description="These terms describe the intended business use of Stockflow ERP and the responsibilities of users operating the platform."
      icon="terms"
    >
      <p>
        Stockflow ERP is an ERP and business management tool designed to help businesses manage inventory, customers, invoices, ledger activity, and operational reporting.
      </p>
      <p>
        Users are responsible for the correctness of all business, customer, invoice, tax, ledger, and related operational data entered into or maintained within the system.
      </p>
      <p>
        WhatsApp messaging through Stockflow ERP is intended only for business communication such as invoices, ledgers, payment updates, and reminders.
      </p>
      <p>
        The service, interface, and supported features may change, improve, or be updated over time as part of normal product maintenance and development.
      </p>
      <p>
        For questions about these terms, contact <a className="font-medium text-slate-900 hover:underline" href="mailto:work.raj01@gmail.com">work.raj01@gmail.com</a>.
      </p>
    </LegalPageLayout>
  );
}
