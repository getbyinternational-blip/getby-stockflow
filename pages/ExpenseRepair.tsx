import Finance from './Finance';

export default function ExpenseRepair() {
  return <Finance repairMode initialTab="expense" lockedTab="expense" embeddedExpenseRepair />;
}
