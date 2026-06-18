import React from 'react';
import LegalPageLayout from './LegalPageLayout';

export default function PrivacyPolicy() {
  return (
    <LegalPageLayout
      title="Privacy Policy"
      description="This page explains how Stockflow ERP handles business data used for ERP workflows, reporting, invoicing, and communication."
      icon="privacy"
    >
      <p>
        Stockflow ERP collects and processes business and customer data only to provide ERP features for store operations and record management.
      </p>
      <p>
        Data stored in Stockflow ERP may include customer names, phone numbers, invoices, ledger records, transaction details, payment activity, and WhatsApp message delivery or status information.
      </p>
      <p>
        This data is used to support invoice generation, ledger management, business reporting, operational workflows, and WhatsApp business notifications such as invoices, ledger updates, and payment reminders.
      </p>
      <p>
        Stockflow ERP does not sell customer or business data.
      </p>
      <p>
        Users may request deletion of applicable data by contacting <a className="font-medium text-slate-900 hover:underline" href="mailto:work.raj01@gmail.com">work.raj01@gmail.com</a>.
      </p>
      <p>
        For privacy questions or deletion-related requests, contact <a className="font-medium text-slate-900 hover:underline" href="mailto:work.raj01@gmail.com">work.raj01@gmail.com</a>.
      </p>
    </LegalPageLayout>
  );
}
