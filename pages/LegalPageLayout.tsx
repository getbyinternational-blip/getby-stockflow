import React from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui';
import { FileText, Shield, Trash2 } from 'lucide-react';

type LegalPageLayoutProps = {
  title: string;
  description: string;
  icon: 'privacy' | 'terms' | 'deletion';
  children: React.ReactNode;
};

const iconMap = {
  privacy: Shield,
  terms: FileText,
  deletion: Trash2,
};

export default function LegalPageLayout({ title, description, icon, children }: LegalPageLayoutProps) {
  const Icon = iconMap[icon];

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-5 sm:px-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
              <Icon className="h-6 w-6 text-slate-700" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Stockflow ERP</div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{title}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{description}</p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-2 text-sm">
            <Link to="/privacy-policy" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-700 transition-colors hover:bg-slate-100">Privacy Policy</Link>
            <Link to="/terms" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-700 transition-colors hover:bg-slate-100">Terms</Link>
            <Link to="/data-deletion" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-700 transition-colors hover:bg-slate-100">Data Deletion</Link>
          </nav>
        </header>

        <Card className="border-slate-200 bg-white">
          <CardHeader>
            <CardTitle className="text-xl text-slate-950">{title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-7 text-slate-700">
            {children}
          </CardContent>
        </Card>

        <footer className="mt-6 text-center text-xs text-slate-500">
          Contact: <a className="font-medium text-slate-700 hover:text-slate-950" href="mailto:work.raj01@gmail.com">work.raj01@gmail.com</a>
        </footer>
      </div>
    </div>
  );
}
