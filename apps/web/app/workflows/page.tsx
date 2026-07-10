import { WorkflowForm } from "../components/WorkflowForm";
import { getFactories } from "../lib/api";
import { getWorkflows } from "../lib/api";

type Workflow = {
  id: string;
  name: string;
  description: string | null;
  stages: Array<{
    id: string;
    name: string;
    code: string;
    kind: string;
    sequence: number;
  }>;
};

export default async function WorkflowsPage() {
  const [result, factoriesResult] = await Promise.all([getWorkflows(), getFactories()]);
  const workflows = (Array.isArray(result) ? result : result.rows) as Workflow[];
  const factories = (Array.isArray(factoriesResult) ? factoriesResult : factoriesResult.rows) as Array<{ id: string; name: string }>;

  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">Configuration</div>
          <h1>SOP Workflows</h1>
          <p>SOP stage routes are configured here. Daily production uploads update progress against these routes.</p>
        </div>
      </header>

      {!Array.isArray(result) && result.apiOffline ? (
        <section className="setup-warning">
          <strong>API is not reachable yet.</strong>
          <p>
            The frontend is running, but it cannot connect to <code>{result.apiUrl}</code>. Start
            the backend with <code>npm run dev:api</code>, then refresh this page.
          </p>
          <p className="setup-error">Error: {result.error}</p>
        </section>
      ) : null}

      <section className="grid">
        <div className="panel">
          <h2>SOP Templates</h2>
          {workflows.length === 0 ? (
            <div className="empty">No SOP workflow templates found.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Stages</th>
                </tr>
              </thead>
              <tbody>
                {workflows.map((workflow) => (
                  <tr key={workflow.id}>
                    <td>{workflow.name}</td>
                    <td>{workflow.description ?? "No description"}</td>
                    <td>
                      {workflow.stages
                        .sort((a, b) => a.sequence - b.sequence)
                        .map((stage) => stage.name)
                        .join(" -> ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <h2>Create SOP Workflow</h2>
          <WorkflowForm factories={factories} />
        </div>
      </section>
    </>
  );
}
