import React from 'react';
import LegalPageLayout from './LegalPageLayout';

export default function DataDeletion() {
  return (
    <LegalPageLayout
      title="Data Deletion"
      description="This page explains how users or customers can request deletion of data associated with Stockflow ERP records."
      icon="deletion"
    >
      <p>
        Users and customers may request deletion of their data associated with Stockflow ERP records.
      </p>
      <p>
        To request deletion, email <a className="font-medium text-slate-900 hover:underline" href="mailto:work.raj01@gmail.com">work.raj01@gmail.com</a> with the business name, phone number, and a clear deletion request.
      </p>
      <p>
        Requests will be reviewed and processed where legally and operationally possible for the business.
      </p>
      <p>
        Some transaction or accounting records may need to be retained for legal, tax, audit, accounting, or business compliance purposes.
      </p>
    </LegalPageLayout>
  );
}
