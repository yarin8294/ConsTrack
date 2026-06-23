import { useEffect } from "react";
import { Card } from "../../components/ui/Card";
import { useAppData } from "../../app/data/useAppData";
import { formatDate } from "../../app/format";

export function ReportsPage() {
  const { reports, deleteReport, refreshReports } = useAppData();

  useEffect(() => { 
    void refreshReports(); 
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xl font-semibold">Reports</div>
        <div className="text-sm muted">
          Reports are generated automatically after each comparison run.
        </div>
      </div>

      <Card 
        title="Report history" 
        subtitle={`${reports.length} report${reports.length !== 1 ? "s" : ""}`}
      >
        {reports.length === 0 ? (
          <div className="text-sm muted">No reports yet. Run a comparison to generate one.</div>
        ) : (
          <div className="divide-y divide-app">
            {reports.map((r) => (
              <div 
                key={r.id} 
                className="flex flex-col sm:flex-row sm:items-center justify-between py-4 gap-3"
              >
                {/* תצוגת התאריך */}
                <div className="text-sm font-medium">
                  Report — {formatDate(r.createdAtISO)}
                </div>
                
                {/* אזור הכפתורים - מתאים את עצמו למסך ומסדר את הכפתורים בצורה בטוחה */}
                <div className="flex flex-wrap gap-2 shrink-0 justify-start sm:justify-end">
                  <a
                    href={r.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-app px-3 py-1.5 text-xs bg-app hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    Download PDF
                  </a>
                  <a
                    href={r.xlsxUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-app px-3 py-1.5 text-xs bg-app hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    Download Excel
                  </a>
                  <button
                    className="rounded-lg border border-red-300 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                    onClick={() => void deleteReport(r.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}