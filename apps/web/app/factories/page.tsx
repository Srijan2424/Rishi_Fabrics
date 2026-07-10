import { FactoryForm } from "../components/FactoryForm";
import { getFactories } from "../lib/api";

type Factory = {
  id: string;
  name: string;
  code: string;
  workingDays: string[];
  shiftsPerDay: number;
  workingHoursPerDay: number;
};

export default async function FactoriesPage() {
  const result = await getFactories();
  const factories = (Array.isArray(result) ? result : result.rows) as Factory[];

  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">Onboarding</div>
          <h1>Company / Site</h1>
          <p>Capture the company or plant-level setup. Production units are tracked separately from this site record.</p>
        </div>
      </header>

      <section className="grid">
        <div className="panel">
          <h2>Company / Site List</h2>
          {factories.length === 0 ? (
            <div className="empty">No company/site records found.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Code</th>
                  <th>Working Days</th>
                  <th>Shifts</th>
                  <th>Hours</th>
                </tr>
              </thead>
              <tbody>
                {factories.map((factory) => (
                  <tr key={factory.id}>
                    <td>{factory.name}</td>
                    <td>{factory.code}</td>
                    <td>{factory.workingDays.join(", ")}</td>
                    <td>{factory.shiftsPerDay}</td>
                    <td>{factory.workingHoursPerDay}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <h2>Create Company / Site</h2>
          <FactoryForm />
        </div>
      </section>
    </>
  );
}
