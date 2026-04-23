const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// =====================================================================
// PROFESSORES
// =====================================================================

// GET /api/professores — lista todos com disciplinas
app.get('/api/professores', async (req, res) => {
  try {
    const professores = await prisma.professor.findMany({
      where: { ativo: true },
      include: { disciplinas: { include: { disciplina: true } } },
      orderBy: { nome: 'asc' },
    });
    // Flatten disciplinas para array de nomes (compatível com frontend)
    const result = professores.map(p => ({
      id: p.id,
      nome: p.nome,
      initials: p.initials,
      color: p.color,
      cpf: p.cpf || '',
      telefone: p.telefone || '',
      email: p.email || '',
      titulacao: p.titulacao,
      disciplinas: p.disciplinas.map(pd => pd.disciplina.nome),
    }));
    res.json(result);
  } catch (err) {
    console.error('GET /api/professores error:', err);
    res.status(500).json({ error: 'Erro ao buscar professores' });
  }
});

// GET /api/professores/:id
app.get('/api/professores/:id', async (req, res) => {
  try {
    const p = await prisma.professor.findUnique({
      where: { id: req.params.id },
      include: { disciplinas: { include: { disciplina: true } } },
    });
    if (!p) return res.status(404).json({ error: 'Professor não encontrado' });
    res.json({
      ...p,
      disciplinas: p.disciplinas.map(pd => pd.disciplina.nome),
    });
  } catch (err) {
    console.error('GET /api/professores/:id error:', err);
    res.status(500).json({ error: 'Erro ao buscar professor' });
  }
});

// POST /api/professores — criar
app.post('/api/professores', async (req, res) => {
  try {
    const { nome, initials, color, cpf, telefone, email, titulacao, disciplinas } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });

    const professor = await prisma.professor.create({
      data: {
        nome,
        initials: initials || nome.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase(),
        color: color || '#6366F1',
        cpf: cpf || null,
        telefone: telefone || null,
        email: email || null,
        titulacao: titulacao || 'graduacao',
      },
    });

    // Vincular disciplinas se fornecidas
    if (disciplinas && disciplinas.length) {
      for (const discNome of disciplinas) {
        const disc = await prisma.disciplina.findUnique({ where: { nome: discNome } });
        if (disc) {
          await prisma.professorDisciplina.create({
            data: { professorId: professor.id, disciplinaId: disc.id },
          });
        }
      }
    }

    const result = await prisma.professor.findUnique({
      where: { id: professor.id },
      include: { disciplinas: { include: { disciplina: true } } },
    });
    res.status(201).json({
      ...result,
      disciplinas: result.disciplinas.map(pd => pd.disciplina.nome),
    });
  } catch (err) {
    console.error('POST /api/professores error:', err);
    res.status(500).json({ error: 'Erro ao criar professor' });
  }
});

// PUT /api/professores/:id — atualizar
app.put('/api/professores/:id', async (req, res) => {
  try {
    const { nome, initials, color, cpf, telefone, email, titulacao, disciplinas } = req.body;
    const professor = await prisma.professor.update({
      where: { id: req.params.id },
      data: {
        ...(nome && { nome }),
        ...(initials && { initials }),
        ...(color && { color }),
        cpf: cpf ?? undefined,
        telefone: telefone ?? undefined,
        email: email ?? undefined,
        ...(titulacao && { titulacao }),
      },
    });

    // Atualizar disciplinas se fornecidas
    if (disciplinas !== undefined) {
      // Remove todas as vinculações
      await prisma.professorDisciplina.deleteMany({ where: { professorId: professor.id } });
      // Recria
      for (const discNome of disciplinas) {
        const disc = await prisma.disciplina.findUnique({ where: { nome: discNome } });
        if (disc) {
          await prisma.professorDisciplina.create({
            data: { professorId: professor.id, disciplinaId: disc.id },
          });
        }
      }
    }

    const result = await prisma.professor.findUnique({
      where: { id: professor.id },
      include: { disciplinas: { include: { disciplina: true } } },
    });
    res.json({
      ...result,
      disciplinas: result.disciplinas.map(pd => pd.disciplina.nome),
    });
  } catch (err) {
    console.error('PUT /api/professores/:id error:', err);
    res.status(500).json({ error: 'Erro ao atualizar professor' });
  }
});

// DELETE /api/professores/:id (soft delete)
app.delete('/api/professores/:id', async (req, res) => {
  try {
    await prisma.professor.update({
      where: { id: req.params.id },
      data: { ativo: false },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/professores/:id error:', err);
    res.status(500).json({ error: 'Erro ao excluir professor' });
  }
});

// =====================================================================
// DISCIPLINAS
// =====================================================================

// GET /api/disciplinas
app.get('/api/disciplinas', async (req, res) => {
  try {
    const disciplinas = await prisma.disciplina.findMany({
      where: { ativa: true },
      orderBy: { nome: 'asc' },
      include: { _count: { select: { professores: true } } },
    });
    res.json(disciplinas.map(d => ({
      id: d.id,
      nome: d.nome,
      professoresCount: d._count.professores,
    })));
  } catch (err) {
    console.error('GET /api/disciplinas error:', err);
    res.status(500).json({ error: 'Erro ao buscar disciplinas' });
  }
});

// POST /api/disciplinas
app.post('/api/disciplinas', async (req, res) => {
  try {
    const { nome } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
    const existing = await prisma.disciplina.findUnique({ where: { nome } });
    if (existing) {
      if (!existing.ativa) {
        // Reativar
        await prisma.disciplina.update({ where: { id: existing.id }, data: { ativa: true } });
        return res.json({ ...existing, ativa: true });
      }
      return res.status(409).json({ error: 'Disciplina já existe' });
    }
    const disc = await prisma.disciplina.create({ data: { nome } });
    res.status(201).json(disc);
  } catch (err) {
    console.error('POST /api/disciplinas error:', err);
    res.status(500).json({ error: 'Erro ao criar disciplina' });
  }
});

// DELETE /api/disciplinas/:id (soft delete)
app.delete('/api/disciplinas/:id', async (req, res) => {
  try {
    await prisma.disciplina.update({
      where: { id: req.params.id },
      data: { ativa: false },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/disciplinas/:id error:', err);
    res.status(500).json({ error: 'Erro ao excluir disciplina' });
  }
});

// =====================================================================
// GRADES ESCOLARES
// =====================================================================

// GET /api/grades — lista com professor
app.get('/api/grades', async (req, res) => {
  try {
    const { escola_id, status, professor_id } = req.query;
    const where = {};
    if (escola_id) where.escolaId = escola_id;
    if (status) where.status = status;
    if (professor_id) where.professorId = professor_id;

    const grades = await prisma.grade.findMany({
      where,
      include: { professor: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(grades.map(g => ({
      id: g.id,
      professor_id: g.professorId,
      professor_nome: g.professor.nome,
      professor_initials: g.professor.initials,
      professor_color: g.professor.color,
      disciplina: g.disciplina,
      escola_id: g.escolaId,
      escola_nome: g.escolaNome,
      total_horas: g.totalHoras,
      total_aulas: g.totalAulas,
      status: g.status,
      grade_array: g.gradeArray,
      data_submissao: g.dataSubmissao.toISOString().slice(0, 10),
      enviado_por: g.enviadoPor,
      aprovado_por: g.aprovadoPor,
      data_aprovacao: g.dataAprovacao?.toISOString(),
      observacoes: g.observacoes,
    })));
  } catch (err) {
    console.error('GET /api/grades error:', err);
    res.status(500).json({ error: 'Erro ao buscar grades' });
  }
});

// POST /api/grades — criar
app.post('/api/grades', async (req, res) => {
  try {
    const { professor_id, disciplina, escola_id, escola_nome, total_horas, total_aulas, grade_array, enviado_por } = req.body;
    if (!professor_id || !disciplina || !escola_id || !grade_array) {
      return res.status(400).json({ error: 'Campos obrigatórios: professor_id, disciplina, escola_id, grade_array' });
    }

    // Validar conflitos de horário
    const existingGrades = await prisma.grade.findMany({
      where: { professorId: professor_id, status: { not: 'devolvido' } },
    });
    const conflicts = [];
    for (const slot of grade_array) {
      for (const eg of existingGrades) {
        const egSlots = eg.gradeArray;
        if (Array.isArray(egSlots)) {
          for (const es of egSlots) {
            if (es.dia === slot.dia && es.horario === slot.horario) {
              conflicts.push({ dia: slot.dia, horario: slot.horario, outra_disciplina: eg.disciplina });
            }
          }
        }
      }
    }
    if (conflicts.length) {
      return res.status(409).json({ error: 'Conflitos de horário detectados', conflicts });
    }

    const grade = await prisma.grade.create({
      data: {
        professorId: professor_id,
        disciplina,
        escolaId: escola_id,
        escolaNome: escola_nome || '',
        totalHoras: total_horas || (grade_array.length * 50 / 60),
        totalAulas: total_aulas || grade_array.length,
        gradeArray: grade_array,
        enviadoPor: enviado_por || null,
        status: 'aguardando_rh',
      },
      include: { professor: true },
    });
    res.status(201).json({
      id: grade.id,
      professor_id: grade.professorId,
      professor_nome: grade.professor.nome,
      disciplina: grade.disciplina,
      escola_id: grade.escolaId,
      escola_nome: grade.escolaNome,
      total_horas: grade.totalHoras,
      total_aulas: grade.totalAulas,
      status: grade.status,
      grade_array: grade.gradeArray,
      data_submissao: grade.dataSubmissao.toISOString().slice(0, 10),
      enviado_por: grade.enviadoPor,
    });
  } catch (err) {
    console.error('POST /api/grades error:', err);
    res.status(500).json({ error: 'Erro ao criar grade' });
  }
});

// PUT /api/grades/:id — atualizar
app.put('/api/grades/:id', async (req, res) => {
  try {
    const { disciplina, escola_id, escola_nome, total_horas, total_aulas, grade_array, status, enviado_por } = req.body;
    const grade = await prisma.grade.update({
      where: { id: req.params.id },
      data: {
        ...(disciplina && { disciplina }),
        ...(escola_id && { escolaId: escola_id }),
        ...(escola_nome && { escolaNome: escola_nome }),
        ...(total_horas && { totalHoras: total_horas }),
        ...(total_aulas && { totalAulas: total_aulas }),
        ...(grade_array && { gradeArray: grade_array }),
        ...(status && { status }),
        ...(enviado_por && { enviadoPor: enviado_por }),
      },
    });
    res.json(grade);
  } catch (err) {
    console.error('PUT /api/grades/:id error:', err);
    res.status(500).json({ error: 'Erro ao atualizar grade' });
  }
});

// PATCH /api/grades/:id/aprovar
app.patch('/api/grades/:id/aprovar', async (req, res) => {
  try {
    const { aprovado_por } = req.body;
    const grade = await prisma.grade.update({
      where: { id: req.params.id },
      data: { status: 'aprovado', aprovadoPor: aprovado_por, dataAprovacao: new Date() },
    });
    res.json(grade);
  } catch (err) {
    console.error('PATCH /api/grades/:id/aprovar error:', err);
    res.status(500).json({ error: 'Erro ao aprovar grade' });
  }
});

// PATCH /api/grades/:id/devolver
app.patch('/api/grades/:id/devolver', async (req, res) => {
  try {
    const { observacoes } = req.body;
    const grade = await prisma.grade.update({
      where: { id: req.params.id },
      data: { status: 'devolvido', observacoes },
    });
    res.json(grade);
  } catch (err) {
    console.error('PATCH /api/grades/:id/devolver error:', err);
    res.status(500).json({ error: 'Erro ao devolver grade' });
  }
});

// DELETE /api/grades/:id
app.delete('/api/grades/:id', async (req, res) => {
  try {
    await prisma.grade.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/grades/:id error:', err);
    res.status(500).json({ error: 'Erro ao excluir grade' });
  }
});

// ─── START SERVER ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 PIPEPED API running on port ${PORT}`);
});
