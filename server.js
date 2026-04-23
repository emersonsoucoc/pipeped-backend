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
    const result = professores.map(p => ({
      id: p.id,
      nome: p.nome,
      initials: p.initials,
      color: p.color,
      cpf: p.cpf || '',
      telefone: p.telefone || '',
      email: p.email || '',
      titulacao: p.titulacao,
      valor_hora_aula: p.valorHoraAula || 0,
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
    const { nome, initials, color, cpf, telefone, email, titulacao, valor_hora_aula, disciplinas } = req.body;
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
        valorHoraAula: valor_hora_aula || 0,
      },
    });

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
    const { nome, initials, color, cpf, telefone, email, titulacao, valor_hora_aula, disciplinas } = req.body;
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
        ...(valor_hora_aula !== undefined && { valorHoraAula: valor_hora_aula }),
      },
    });

    if (disciplinas !== undefined) {
      await prisma.professorDisciplina.deleteMany({ where: { professorId: professor.id } });
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

app.post('/api/disciplinas', async (req, res) => {
  try {
    const { nome } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
    const existing = await prisma.disciplina.findUnique({ where: { nome } });
    if (existing) {
      if (!existing.ativa) {
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
// SEGMENTOS  (Infantil, Fund.1, Fund.2, Médio)
// =====================================================================

// GET /api/segmentos?escola_id=xxx
app.get('/api/segmentos', async (req, res) => {
  try {
    const where = { ativo: true };
    if (req.query.escola_id) where.escolaId = req.query.escola_id;
    const segmentos = await prisma.segmento.findMany({
      where,
      include: {
        series: {
          where: { ativa: true },
          orderBy: { ordem: 'asc' },
          include: {
            turmas: {
              where: { ativa: true },
              orderBy: { nome: 'asc' },
            },
          },
        },
      },
      orderBy: { ordem: 'asc' },
    });
    res.json(segmentos.map(s => ({
      id: s.id,
      nome: s.nome,
      escola_id: s.escolaId,
      ordem: s.ordem,
      series: s.series.map(sr => ({
        id: sr.id,
        nome: sr.nome,
        ordem: sr.ordem,
        turmas: sr.turmas.map(t => ({
          id: t.id,
          nome: t.nome,
          turno: t.turno,
        })),
      })),
    })));
  } catch (err) {
    console.error('GET /api/segmentos error:', err);
    res.status(500).json({ error: 'Erro ao buscar segmentos' });
  }
});

// POST /api/segmentos — criar segmento
app.post('/api/segmentos', async (req, res) => {
  try {
    const { nome, escola_id, ordem } = req.body;
    if (!nome || !escola_id) return res.status(400).json({ error: 'nome e escola_id são obrigatórios' });
    const seg = await prisma.segmento.create({
      data: { nome, escolaId: escola_id, ordem: ordem || 0 },
    });
    res.status(201).json({ id: seg.id, nome: seg.nome, escola_id: seg.escolaId, ordem: seg.ordem, series: [] });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Segmento já existe nesta escola' });
    console.error('POST /api/segmentos error:', err);
    res.status(500).json({ error: 'Erro ao criar segmento' });
  }
});

// PUT /api/segmentos/:id
app.put('/api/segmentos/:id', async (req, res) => {
  try {
    const { nome, ordem } = req.body;
    const seg = await prisma.segmento.update({
      where: { id: req.params.id },
      data: { ...(nome && { nome }), ...(ordem !== undefined && { ordem }) },
    });
    res.json(seg);
  } catch (err) {
    console.error('PUT /api/segmentos/:id error:', err);
    res.status(500).json({ error: 'Erro ao atualizar segmento' });
  }
});

// DELETE /api/segmentos/:id (soft)
app.delete('/api/segmentos/:id', async (req, res) => {
  try {
    await prisma.segmento.update({ where: { id: req.params.id }, data: { ativo: false } });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/segmentos/:id error:', err);
    res.status(500).json({ error: 'Erro ao excluir segmento' });
  }
});

// =====================================================================
// SÉRIES  (1º ano, 2º ano, Grupo 3, etc.)
// =====================================================================

// GET /api/series?segmento_id=xxx
app.get('/api/series', async (req, res) => {
  try {
    const where = { ativa: true };
    if (req.query.segmento_id) where.segmentoId = req.query.segmento_id;
    const series = await prisma.serie.findMany({
      where,
      include: {
        turmas: { where: { ativa: true }, orderBy: { nome: 'asc' } },
        segmento: true,
      },
      orderBy: { ordem: 'asc' },
    });
    res.json(series.map(sr => ({
      id: sr.id,
      nome: sr.nome,
      segmento_id: sr.segmentoId,
      segmento_nome: sr.segmento.nome,
      ordem: sr.ordem,
      turmas: sr.turmas.map(t => ({ id: t.id, nome: t.nome, turno: t.turno })),
    })));
  } catch (err) {
    console.error('GET /api/series error:', err);
    res.status(500).json({ error: 'Erro ao buscar séries' });
  }
});

// POST /api/series
app.post('/api/series', async (req, res) => {
  try {
    const { nome, segmento_id, ordem } = req.body;
    if (!nome || !segmento_id) return res.status(400).json({ error: 'nome e segmento_id são obrigatórios' });
    const serie = await prisma.serie.create({
      data: { nome, segmentoId: segmento_id, ordem: ordem || 0 },
    });
    res.status(201).json({ id: serie.id, nome: serie.nome, segmento_id: serie.segmentoId, ordem: serie.ordem, turmas: [] });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Série já existe neste segmento' });
    console.error('POST /api/series error:', err);
    res.status(500).json({ error: 'Erro ao criar série' });
  }
});

// DELETE /api/series/:id (soft)
app.delete('/api/series/:id', async (req, res) => {
  try {
    await prisma.serie.update({ where: { id: req.params.id }, data: { ativa: false } });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/series/:id error:', err);
    res.status(500).json({ error: 'Erro ao excluir série' });
  }
});

// =====================================================================
// TURMAS  (A, B, C)
// =====================================================================

// GET /api/turmas?serie_id=xxx
app.get('/api/turmas', async (req, res) => {
  try {
    const where = { ativa: true };
    if (req.query.serie_id) where.serieId = req.query.serie_id;
    const turmas = await prisma.turma.findMany({
      where,
      include: { serie: { include: { segmento: true } } },
      orderBy: { nome: 'asc' },
    });
    res.json(turmas.map(t => ({
      id: t.id,
      nome: t.nome,
      turno: t.turno,
      serie_id: t.serieId,
      serie_nome: t.serie.nome,
      segmento_id: t.serie.segmentoId,
      segmento_nome: t.serie.segmento.nome,
    })));
  } catch (err) {
    console.error('GET /api/turmas error:', err);
    res.status(500).json({ error: 'Erro ao buscar turmas' });
  }
});

// POST /api/turmas
app.post('/api/turmas', async (req, res) => {
  try {
    const { nome, serie_id, turno } = req.body;
    if (!nome || !serie_id) return res.status(400).json({ error: 'nome e serie_id são obrigatórios' });
    const turma = await prisma.turma.create({
      data: { nome, serieId: serie_id, turno: turno || 'matutino' },
    });
    res.status(201).json({ id: turma.id, nome: turma.nome, turno: turma.turno, serie_id: turma.serieId });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Turma já existe nesta série' });
    console.error('POST /api/turmas error:', err);
    res.status(500).json({ error: 'Erro ao criar turma' });
  }
});

// DELETE /api/turmas/:id (soft)
app.delete('/api/turmas/:id', async (req, res) => {
  try {
    await prisma.turma.update({ where: { id: req.params.id }, data: { ativa: false } });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/turmas/:id error:', err);
    res.status(500).json({ error: 'Erro ao excluir turma' });
  }
});

// =====================================================================
// GRADES ESCOLARES (atualizado com segmento/turma/extras)
// =====================================================================

// GET /api/grades — lista com professor, segmento, turma
app.get('/api/grades', async (req, res) => {
  try {
    const { escola_id, status, professor_id, segmento_id, turma_id } = req.query;
    const where = {};
    if (escola_id) where.escolaId = escola_id;
    if (status) where.status = status;
    if (professor_id) where.professorId = professor_id;
    if (segmento_id) where.segmentoId = segmento_id;
    if (turma_id) where.turmaId = turma_id;

    const grades = await prisma.grade.findMany({
      where,
      include: {
        professor: true,
        segmento: true,
        serie: true,
        turma: true,
      },
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
      segmento_id: g.segmentoId,
      segmento_nome: g.segmento?.nome || null,
      serie_id: g.serieId,
      serie_nome: g.serie?.nome || null,
      turma_id: g.turmaId,
      turma_nome: g.turma?.nome || null,
      turma_turno: g.turma?.turno || null,
      total_horas: g.totalHoras,
      total_aulas: g.totalAulas,
      status: g.status,
      grade_array: g.gradeArray,
      horas_extras: g.horasExtras,
      coord_pedagogica: g.coordPedagogica,
      substituicoes: g.substituicoes,
      obs_extras: g.obsExtras,
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

// GET /api/grades/resumo-folha — Resumo consolidado por professor para folha
app.get('/api/grades/resumo-folha', async (req, res) => {
  try {
    const { escola_id } = req.query;
    const where = { status: 'aprovado' };
    if (escola_id) where.escolaId = escola_id;

    const grades = await prisma.grade.findMany({
      where,
      include: { professor: true, segmento: true, turma: true },
      orderBy: { professor: { nome: 'asc' } },
    });

    // Agrupar por professor
    const byProf = {};
    for (const g of grades) {
      if (!byProf[g.professorId]) {
        byProf[g.professorId] = {
          professor_id: g.professorId,
          professor_nome: g.professor.nome,
          professor_initials: g.professor.initials,
          professor_color: g.professor.color,
          titulacao: g.professor.titulacao,
          valor_hora_aula: g.professor.valorHoraAula || 0,
          total_aulas: 0,
          total_horas: 0,
          horas_extras: 0,
          coord_pedagogica: 0,
          substituicoes: 0,
          carga_total_semanal: 0,
          custo_semanal: 0,
          custo_mensal: 0,
          disciplinas: [],
          escolas: [],
          grades: [],
        };
      }
      const prof = byProf[g.professorId];
      prof.total_aulas += g.totalAulas;
      prof.total_horas += g.totalHoras;
      prof.horas_extras += g.horasExtras;
      prof.coord_pedagogica += g.coordPedagogica;
      prof.substituicoes += g.substituicoes;
      if (!prof.disciplinas.includes(g.disciplina)) prof.disciplinas.push(g.disciplina);
      if (!prof.escolas.includes(g.escolaNome)) prof.escolas.push(g.escolaNome);
      prof.grades.push({
        id: g.id,
        disciplina: g.disciplina,
        escola_nome: g.escolaNome,
        segmento_nome: g.segmento?.nome || '',
        turma_nome: g.turma?.nome || '',
        total_aulas: g.totalAulas,
        total_horas: g.totalHoras,
        horas_extras: g.horasExtras,
        coord_pedagogica: g.coordPedagogica,
        substituicoes: g.substituicoes,
      });
    }

    // Calcular carga total
    const result = Object.values(byProf).map(p => {
      const carga = +(p.total_horas + p.horas_extras + p.coord_pedagogica + p.substituicoes).toFixed(2);
      const custoSemanal = +(carga * p.valor_hora_aula).toFixed(2);
      return {
        ...p,
        carga_total_semanal: carga,
        custo_semanal: custoSemanal,
        custo_mensal: +(custoSemanal * 4.5).toFixed(2), // ~4.5 semanas/mês
      };
    });

    res.json(result);
  } catch (err) {
    console.error('GET /api/grades/resumo-folha error:', err);
    res.status(500).json({ error: 'Erro ao gerar resumo da folha' });
  }
});

// POST /api/grades — criar (com segmento/turma/extras)
app.post('/api/grades', async (req, res) => {
  try {
    const {
      professor_id, disciplina, escola_id, escola_nome,
      segmento_id, serie_id, turma_id,
      total_horas, total_aulas, grade_array, enviado_por,
      horas_extras, coord_pedagogica, substituicoes, obs_extras,
    } = req.body;
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
        segmentoId: segmento_id || null,
        serieId: serie_id || null,
        turmaId: turma_id || null,
        totalHoras: total_horas || (grade_array.length * 50 / 60),
        totalAulas: total_aulas || grade_array.length,
        gradeArray: grade_array,
        enviadoPor: enviado_por || null,
        horasExtras: horas_extras || 0,
        coordPedagogica: coord_pedagogica || 0,
        substituicoes: substituicoes || 0,
        obsExtras: obs_extras || null,
        status: 'aguardando_rh',
      },
      include: { professor: true, segmento: true, serie: true, turma: true },
    });
    res.status(201).json({
      id: grade.id,
      professor_id: grade.professorId,
      professor_nome: grade.professor.nome,
      disciplina: grade.disciplina,
      escola_id: grade.escolaId,
      escola_nome: grade.escolaNome,
      segmento_id: grade.segmentoId,
      segmento_nome: grade.segmento?.nome || null,
      serie_id: grade.serieId,
      serie_nome: grade.serie?.nome || null,
      turma_id: grade.turmaId,
      turma_nome: grade.turma?.nome || null,
      total_horas: grade.totalHoras,
      total_aulas: grade.totalAulas,
      status: grade.status,
      grade_array: grade.gradeArray,
      horas_extras: grade.horasExtras,
      coord_pedagogica: grade.coordPedagogica,
      substituicoes: grade.substituicoes,
      obs_extras: grade.obsExtras,
      data_submissao: grade.dataSubmissao.toISOString().slice(0, 10),
      enviado_por: grade.enviadoPor,
    });
  } catch (err) {
    console.error('POST /api/grades error:', err);
    res.status(500).json({ error: 'Erro ao criar grade' });
  }
});

// PUT /api/grades/:id — atualizar (com extras)
app.put('/api/grades/:id', async (req, res) => {
  try {
    const {
      disciplina, escola_id, escola_nome, segmento_id, serie_id, turma_id,
      total_horas, total_aulas, grade_array, status, enviado_por,
      horas_extras, coord_pedagogica, substituicoes, obs_extras,
    } = req.body;
    const grade = await prisma.grade.update({
      where: { id: req.params.id },
      data: {
        ...(disciplina && { disciplina }),
        ...(escola_id && { escolaId: escola_id }),
        ...(escola_nome && { escolaNome: escola_nome }),
        ...(segmento_id !== undefined && { segmentoId: segmento_id || null }),
        ...(serie_id !== undefined && { serieId: serie_id || null }),
        ...(turma_id !== undefined && { turmaId: turma_id || null }),
        ...(total_horas && { totalHoras: total_horas }),
        ...(total_aulas && { totalAulas: total_aulas }),
        ...(grade_array && { gradeArray: grade_array }),
        ...(status && { status }),
        ...(enviado_por && { enviadoPor: enviado_por }),
        ...(horas_extras !== undefined && { horasExtras: horas_extras }),
        ...(coord_pedagogica !== undefined && { coordPedagogica: coord_pedagogica }),
        ...(substituicoes !== undefined && { substituicoes: substituicoes }),
        ...(obs_extras !== undefined && { obsExtras: obs_extras }),
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

// =====================================================================
// SUBSTITUIÇÕES
// =====================================================================

// GET /api/substituicoes?escola_id=xxx&mes=2026-04&substituto_id=xxx
app.get('/api/substituicoes', async (req, res) => {
  try {
    const { escola_id, substituto_id, ausente_id, mes } = req.query;
    const where = {};
    if (escola_id) where.escolaId = escola_id;
    if (substituto_id) where.substitutoId = substituto_id;
    if (ausente_id) where.ausenteId = ausente_id;
    if (mes) {
      const [y, m] = mes.split('-').map(Number);
      where.data = { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) };
    }

    const subs = await prisma.substituicao.findMany({
      where,
      include: { substituto: true, ausente: true },
      orderBy: { data: 'desc' },
    });
    res.json(subs.map(s => ({
      id: s.id,
      data: s.data.toISOString().slice(0, 10),
      substituto_id: s.substitutoId,
      substituto_nome: s.substituto.nome,
      substituto_initials: s.substituto.initials,
      substituto_color: s.substituto.color,
      ausente_id: s.ausenteId,
      ausente_nome: s.ausente.nome,
      escola_id: s.escolaId,
      escola_nome: s.escolaNome,
      turma_id: s.turmaId,
      turma_nome: s.turmaNome,
      segmento_nome: s.segmentoNome,
      disciplina: s.disciplina,
      horarios: s.horarios,
      total_aulas: s.totalAulas,
      total_horas: s.totalHoras,
      motivo: s.motivo,
      observacoes: s.observacoes,
      registrado_por: s.registradoPor,
      status: s.status,
    })));
  } catch (err) {
    console.error('GET /api/substituicoes error:', err);
    res.status(500).json({ error: 'Erro ao buscar substituições' });
  }
});

// GET /api/substituicoes/resumo — total de horas por professor substituto (para folha)
app.get('/api/substituicoes/resumo', async (req, res) => {
  try {
    const { escola_id, mes } = req.query;
    const where = {};
    if (escola_id) where.escolaId = escola_id;
    if (mes) {
      const [y, m] = mes.split('-').map(Number);
      where.data = { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) };
    }

    const subs = await prisma.substituicao.findMany({
      where,
      include: { substituto: true },
    });

    const byProf = {};
    for (const s of subs) {
      if (!byProf[s.substitutoId]) {
        byProf[s.substitutoId] = {
          professor_id: s.substitutoId,
          professor_nome: s.substituto.nome,
          total_aulas: 0,
          total_horas: 0,
          registros: 0,
        };
      }
      byProf[s.substitutoId].total_aulas += s.totalAulas;
      byProf[s.substitutoId].total_horas += s.totalHoras;
      byProf[s.substitutoId].registros += 1;
    }
    res.json(Object.values(byProf));
  } catch (err) {
    console.error('GET /api/substituicoes/resumo error:', err);
    res.status(500).json({ error: 'Erro ao gerar resumo' });
  }
});

// POST /api/substituicoes
app.post('/api/substituicoes', async (req, res) => {
  try {
    const {
      data, substituto_id, ausente_id, escola_id, escola_nome,
      turma_id, turma_nome, segmento_nome, disciplina,
      horarios, motivo, observacoes, registrado_por,
    } = req.body;
    if (!data || !substituto_id || !ausente_id || !disciplina || !horarios?.length) {
      return res.status(400).json({ error: 'Campos obrigatórios: data, substituto_id, ausente_id, disciplina, horarios' });
    }

    const totalAulas = horarios.length;
    const totalHoras = +(totalAulas * 50 / 60).toFixed(2);

    const sub = await prisma.substituicao.create({
      data: {
        data: new Date(data),
        substitutoId: substituto_id,
        ausenteId: ausente_id,
        escolaId: escola_id || '',
        escolaNome: escola_nome || '',
        turmaId: turma_id || null,
        turmaNome: turma_nome || null,
        segmentoNome: segmento_nome || null,
        disciplina,
        horarios,
        totalAulas,
        totalHoras,
        motivo: motivo || null,
        observacoes: observacoes || null,
        registradoPor: registrado_por || null,
      },
      include: { substituto: true, ausente: true },
    });
    res.status(201).json({
      id: sub.id,
      data: sub.data.toISOString().slice(0, 10),
      substituto_nome: sub.substituto.nome,
      ausente_nome: sub.ausente.nome,
      total_aulas: sub.totalAulas,
      total_horas: sub.totalHoras,
    });
  } catch (err) {
    console.error('POST /api/substituicoes error:', err);
    res.status(500).json({ error: 'Erro ao registrar substituição' });
  }
});

// DELETE /api/substituicoes/:id
app.delete('/api/substituicoes/:id', async (req, res) => {
  try {
    await prisma.substituicao.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/substituicoes/:id error:', err);
    res.status(500).json({ error: 'Erro ao excluir substituição' });
  }
});

// ─── START SERVER ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 PIPEPED API running on port ${PORT}`);
});
