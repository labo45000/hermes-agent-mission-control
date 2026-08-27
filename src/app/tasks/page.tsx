"use client";

import { useEffect, useState } from "react";
import { Button, Pill, rise } from "@/components/ui/kit";

interface Task {
  id: string;
  name: string;
  status: string;
  priority: string;
  category: string;
  dueDate?: string;
}

const columns = [
  { id: "Not started", label: "To Do" },
  { id: "Approved", label: "Approved" },
  { id: "In progress", label: "In Progress" },
  { id: "Done", label: "Done" },
];

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTask, setNewTask] = useState("");
  const [showAddTask, setShowAddTask] = useState(false);
  const [sourceStatus, setSourceStatus] = useState<'available' | 'unavailable'>('unavailable');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTasks();
  }, []);

  async function fetchTasks() {
    try {
      const res = await fetch("/api/tasks");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Tasks request failed (${res.status})`);
      setTasks(data.tasks || []);
      setSourceStatus(data.status === 'available' ? 'available' : 'unavailable');
      setUpdatedAt(typeof data.updatedAt === 'string' ? data.updatedAt : null);
      setError(null);
    } catch (e) {
      setTasks([]);
      setSourceStatus('unavailable');
      setUpdatedAt(null);
      setError(e instanceof Error ? e.message : 'Tasks are unavailable');
    } finally {
      setLoading(false);
    }
  }

  async function addTask() {
    if (!newTask.trim()) return;
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTask, status: "Not started" }),
      });
      if (!response.ok) throw new Error(`Task was not created (${response.status})`);
      setNewTask("");
      setShowAddTask(false);
      fetchTasks();
    } catch (e) {
      console.error("Failed to add task", e);
    }
  }

  async function updateTaskStatus(taskId: string, newStatus: string) {
    try {
      const response = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId, status: newStatus }),
      });
      if (!response.ok) throw new Error(`Task was not updated (${response.status})`);
      fetchTasks();
    } catch (e) {
      console.error("Failed to update task", e);
    }
  }

  if (loading) {
    return (
      <>
        <div className="relative z-10 w-full mx-auto pt-4">
          <div className="flex justify-between items-center mb-10">
            <div>
              <div className="sk h-3 w-20 mb-3" />
              <div className="sk h-7 w-28" />
            </div>
            <div className="sk h-9 w-28 rounded-full" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="panel p-4">
                <div className="sk h-4 w-16 mb-4" />
                <div className="space-y-2">
                  {[...Array(i + 1)].map((_, j) => <div key={j} className="sk h-16 rounded-[var(--r-md)]" />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="relative z-10 h-full flex flex-col w-full mx-auto pt-4 pb-16">
        <div className="hq-rise flex justify-between items-end gap-4 mb-10" style={rise(0)}>
          <div>
            <div className="eyebrow mb-2">{sourceStatus === 'available' && updatedAt ? `Notion · ${new Date(updatedAt).toLocaleString()}` : 'Notion unavailable'}</div>
            <h1 className="text-[32px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">Tasks</h1>
          </div>
          <Button variant="primary" onClick={() => setShowAddTask(true)} disabled={sourceStatus !== 'available'}>+ Add Task</Button>
        </div>

        {error && <div className="panel mb-6 p-4 text-sm text-[var(--text-3)]">{error}. Configure Notion to read or change tasks.</div>}

        {showAddTask && (
          <div className="hq-rise elevated mb-8 p-5">
            <input
              type="text"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              placeholder="What needs to be done?"
              className="w-full bg-[var(--surface-1)] border border-[var(--line)] text-[var(--text)] placeholder-[var(--text-3)] rounded-[var(--r-md)] px-4 py-3 mb-3 text-[14px] focus:outline-none focus:border-[var(--line-strong)]"
              onKeyDown={(e) => e.key === "Enter" && addTask()}
              autoFocus
            />
            <div className="flex gap-2">
              <Button variant="primary" onClick={addTask}>Add Task</Button>
              <Button variant="ghost" onClick={() => setShowAddTask(false)}>Cancel</Button>
            </div>
          </div>
        )}

        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 overflow-hidden">
          {columns.map((column, idx) => {
            const count = tasks.filter((t) => t.status === column.id).length;
            return (
              <div key={column.id} className="hq-rise panel flex flex-col overflow-hidden" style={rise(idx + 1)}>
                <div className="px-4 py-3.5 flex items-center justify-between">
                  <span className="eyebrow">{column.label}</span>
                  <span className="num text-[11px] text-[var(--text-3)]">{count}</span>
                </div>
                <div className="rule" />
                <div className="flex-1 p-2.5 space-y-2 overflow-y-auto">
                  {tasks
                    .filter((t) => t.status === column.id)
                    .map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        done={column.id === "Done"}
                        onStatusChange={(status) => updateTaskStatus(task.id, status)}
                      />
                    ))}
                  {count === 0 && (
                    <p className="text-[var(--text-4)] text-[12.5px] text-center py-8">No tasks</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function TaskCard({
  task,
  done,
  onStatusChange,
}: {
  task: Task;
  done?: boolean;
  onStatusChange: (status: string) => void;
}) {
  const priorityTone: Record<string, "warn" | "neutral"> = {
    High: "warn",
    Medium: "neutral",
    Low: "neutral",
  };

  return (
    <div className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface-1)] p-3.5 transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] cursor-pointer group">
      <p className={`font-medium text-[13px] mb-3 leading-relaxed ${done ? "text-[var(--text-3)] line-through" : "text-[var(--text)]"}`}>
        {task.name}
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        {task.priority && (
          <Pill tone={priorityTone[task.priority] || "neutral"}>{task.priority}</Pill>
        )}
        {task.category && (
          <span className="text-[11px] text-[var(--text-3)]">{task.category}</span>
        )}
      </div>
      <div className="mt-3 pt-3 border-t border-[var(--line)] opacity-0 group-hover:opacity-100 transition-opacity">
        <select
          className="text-[12px] bg-[var(--surface-1)] text-[var(--text-2)] rounded-[var(--r-sm)] px-3 py-2 w-full border border-[var(--line)] focus:outline-none focus:border-[var(--line-strong)]"
          value={task.status}
          onChange={(e) => onStatusChange(e.target.value)}
        >
          {columns.map((col) => (
            <option key={col.id} value={col.id}>
              Move to {col.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
