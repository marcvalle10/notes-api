import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json());

const corsOrigin = process.env.CORS_ORIGIN || "*";
app.use(cors({ origin: corsOrigin }));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en variables de entorno.");
}

// OJO: service role key SOLO en servidor (Railway), NUNCA en Flutter
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Middleware: valida el usuario con el JWT de Supabase (Bearer token)
async function requireUser(req, res, next) {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing Bearer token" });

    const { data, error } = await sb.auth.getUser(token);
    if (error || !data ? .user) return res.status(401).json({ error: "Invalid token" });

    req.user = data.user; // { id, ... }
    next();
}

app.get("/health", (req, res) => res.json({ ok: true }));

// 1) ensureProfile (similar a tu ensureProfile)
app.post("/profile", requireUser, async(req, res) => {
    const { name, token } = req.body;
    if (!name || !token) return res.status(400).json({ error: "name y token son requeridos" });

    const { error } = await sb.from("profiles").upsert({
        id: req.user.id,
        name,
        token
    });

    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
});

// 2) pushLocalNote
app.post("/notes", requireUser, async(req, res) => {
    const { id, title, content, color_value, updated_at } = req.body;
    if (!id || !title) return res.status(400).json({ error: "id y title son requeridos" });

    const { error } = await sb.from("notes").upsert({
        id,
        owner_id: req.user.id,
        title,
        content: content ? ? "",
        color_value: color_value ? ? 0,
        updated_at: updated_at ? ? new Date().toISOString()
    });

    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
});

// 3) pullMyNotes
app.get("/notes", requireUser, async(req, res) => {
    const { data, error } = await sb
        .from("notes")
        .select("*")
        .eq("owner_id", req.user.id)
        .order("updated_at", { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    res.json({ notes: data ? ? [] });
});

// 4) pullSharedNotesWithPerms (similar a tu select en note_shares)
app.get("/shared", requireUser, async(req, res) => {
    const { data, error } = await sb
        .from("note_shares")
        .select("can_edit, notes(id,title,content,color_value,updated_at)")
        .eq("shared_with", req.user.id);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ items: data ? ? [] });
});

// 5) shareNoteByToken (usa tu RPC find_profile_by_token)
app.post("/share", requireUser, async(req, res) => {
    const { note_id, token, can_edit } = req.body;
    if (!note_id || !token) return res.status(400).json({ error: "note_id y token son requeridos" });

    const { data: prof, error: rpcErr } = await sb.rpc("find_profile_by_token", { p_token: token });
    if (rpcErr) return res.status(400).json({ error: rpcErr.message });
    if (!prof ? .length) return res.status(404).json({ error: "Token no encontrado" });

    const targetId = prof[0].id;
    if (targetId === req.user.id) return res.status(400).json({ error: "No puedes compartirte a ti mismo" });

    // verifica dueño
    const { data: noteRow, error: noteErr } = await sb
        .from("notes")
        .select("id, owner_id")
        .eq("id", note_id)
        .maybeSingle();

    if (noteErr) return res.status(400).json({ error: noteErr.message });
    if (!noteRow) return res.status(400).json({ error: "Nota no sincronizada aún (haz Sync primero)" });
    if (noteRow.owner_id !== req.user.id) return res.status(403).json({ error: "No eres dueño de esa nota" });

    const { error } = await sb.from("note_shares").insert({
        note_id,
        shared_with: targetId,
        can_edit: !!can_edit
    });

    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
});

// 6) updateSharedNote
app.put("/notes/:id", requireUser, async(req, res) => {
    const noteId = req.params.id;
    const { title, content, color_value } = req.body;

    const { error } = await sb.from("notes")
        .update({
            title,
            content,
            color_value,
            updated_at: new Date().toISOString()
        })
        .eq("id", noteId);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
});

// 7) deleteRemoteNote
app.delete("/notes/:id", requireUser, async(req, res) => {
    const noteId = req.params.id;
    const { error } = await sb.from("notes").delete().eq("id", noteId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("API up on port", port));