import io
import math
import random
from reportlab.lib.pagesizes import A4
from openpyxl import Workbook
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, Image, KeepTogether
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.platypus import Flowable
from reportlab.lib.utils import ImageReader  

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np


LIGHT_BG  = "FFF0F4F8"
NAVY_HEX  = "0D1B2A"
STEEL_HEX = "1B3A5C"
ACCENT_HEX = "00C6A7"
ACCENT2   = "F4A261"
MID_GRAY  = "8A9BB0"
GREEN_OK  = "06D6A0"
RED_ZONE  = "E63946"
WHITE     = "FFFFFFFF"
YELLOW_H  = "FFD166"


def rl_color(hex_value):
    hex_value = str(hex_value).lstrip('#')
    if len(hex_value) == 8:
        hex_value = hex_value[2:]
    return colors.HexColor(f'#{hex_value}')

W, H = A4

# FAKE DATA
RUN_ID        = '665f1c2d3e4f5a6b7c8d9e0f'
GENERATED     = '2026-06-05T11:22:22.283Z'
T1_SCAN       = 'scan_early_2026'
T2_SCAN       = 'scan_later_2026'
OVERALL_PCT   = 65.5
VOL_T1        = 150.450
VOL_T2        = 120.150
VOL_DELTA     = -30.300
FORECAST      = '2026-08-15'
ALIGNMENT     = 'HIGH'

ZONES = [
    {'name': 'North Wing',     'type': 'Structure', 'completion': 72.0, 'progress': 80.0, 'vol': -20.100},
    {'name': 'South Block',    'type': 'Foundation','completion': 45.0, 'progress': 45.2, 'vol': -10.200},
    {'name': 'East Corridor',  'type': 'Frame',     'completion': 60.0, 'progress': 68.0, 'vol': -5.800},
    {'name': 'West Annex',     'type': 'Structure', 'completion': 55.0, 'progress': 58.5, 'vol': -7.400},
    {'name': 'Central Hub',    'type': 'Interior',  'completion': 30.0, 'progress': 35.0, 'vol': -3.200},
    {'name': 'Roof Section A', 'type': 'Roofing',   'completion': 88.0, 'progress': 91.0, 'vol': -8.600},
]

TIMELINE = {
    'weeks': ['W1','W2','W3','W4','W5','W6','W7','W8'],
    'actual':   [5.2, 6.8, 7.1, 8.4, 9.0, 10.2, 11.5, 12.3],
    'planned':  [6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0],
    'cumActual':[5.2,12.0,19.1,27.5,36.5,46.7,58.2,65.5],
    'cumPlan':  [6.0,13.0,21.0,30.0,40.0,51.0,63.0,76.0],
}

def fig_to_image(fig, dpi=150):
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=dpi, bbox_inches='tight',
                facecolor='none', transparent=True)
    buf.seek(0)
    plt.close(fig)
    return buf

def mpl_style():
    plt.rcParams.update({
        'font.family': 'DejaVu Sans',
        'axes.facecolor': '#FFF0F4F8',
        'figure.facecolor': 'none',
        'axes.edgecolor': '#8A9BB0',
        'axes.labelcolor': '#0D1B2A',
        'xtick.color': '#0D1B2A',
        'ytick.color': '#0D1B2A',
        'grid.color': '#FFFFFF',
        'grid.linewidth': 0.8,
        'axes.grid': True,
        'axes.spines.top': False,
        'axes.spines.right': False,
    })

def chart_cumulative():
    mpl_style()
    fig, ax = plt.subplots(figsize=(7, 3.2))
    weeks = TIMELINE['weeks']
    x = np.arange(len(weeks))
    ax.fill_between(x, TIMELINE['cumPlan'], alpha=0.15, color='#1B3A5C')
    ax.fill_between(x, TIMELINE['cumActual'], alpha=0.25, color='#00C6A7')
    ax.plot(x, TIMELINE['cumPlan'], '--', color='#F4A261', linewidth=2, label='Planned', marker='o', markersize=5)
    ax.plot(x, TIMELINE['cumActual'], '-', color='#00C6A7', linewidth=2.5, label='Actual', marker='o', markersize=6)
    ax.set_xticks(x)
    ax.set_xticklabels(weeks, fontsize=9)
    ax.set_ylabel('Cumulative Progress (%)', fontsize=9)
    ax.set_ylim(0, 100)
    ax.legend(loc='upper left', fontsize=9, framealpha=0.8)
    ax.set_title('Cumulative Progress vs. Planned Schedule', fontsize=11, fontweight='bold', color='#0D1B2A', pad=10)
    fig.tight_layout()
    return fig_to_image(fig)

def chart_workrate():
    mpl_style()
    fig, ax = plt.subplots(figsize=(7, 3.0))
    weeks = TIMELINE['weeks']
    x = np.arange(len(weeks))
    w = 0.35
    bars_plan = ax.bar(x - w/2, TIMELINE['planned'], w, label='Planned', color='#1B3A5C', alpha=0.7, zorder=3)
    bars_act  = ax.bar(x + w/2, TIMELINE['actual'],  w, label='Actual',  color='#00C6A7', alpha=0.85, zorder=3)
    for bar in bars_act:
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.2, f'{bar.get_height():.1f}', ha='center', va='bottom', fontsize=7.5, color='#0D1B2A')
    ax.set_xticks(x)
    ax.set_xticklabels(weeks, fontsize=9)
    ax.set_ylabel('Weekly Progress (%)', fontsize=9)
    ax.legend(fontsize=9)
    ax.set_title('Weekly Work Rate - Planned vs. Actual', fontsize=11, fontweight='bold', color='#0D1B2A', pad=10)
    fig.tight_layout()
    return fig_to_image(fig)

def chart_zone_progress():
    mpl_style()
    fig, ax = plt.subplots(figsize=(7, 3.2))
    names = [z['name'] for z in ZONES]
    progress = [z['progress'] for z in ZONES]
    completion = [z['completion'] for z in ZONES]
    y = np.arange(len(names))
    h = 0.35
    colors_prog = ['#00C6A7' if p >= c else '#E63946' for p, c in zip(progress, completion)]
    ax.barh(y + h/2, progress, h, color=colors_prog, alpha=0.85, label='Current Progress', zorder=3)
    ax.barh(y - h/2, completion, h, color='#1B3A5C', alpha=0.6, label='Historical Target', zorder=3)
    for i, (p, c) in enumerate(zip(progress, completion)):
        ax.text(p + 0.5, i + h/2, f'{p:.1f}%', va='center', fontsize=8, color='#0D1B2A')
    ax.set_yticks(y)
    ax.set_yticklabels(names, fontsize=9)
    ax.set_xlabel('Completion (%)', fontsize=9)
    ax.set_xlim(0, 110)
    ax.legend(fontsize=9, loc='lower right')
    ax.set_title('Zone-by-Zone Progress vs. Target', fontsize=11, fontweight='bold', color='#0D1B2A', pad=10)
    fig.tight_layout()
    return fig_to_image(fig)

def chart_heatmap():
    mpl_style()
    fig, ax = plt.subplots(figsize=(7, 3.2))
    weeks_h = ['W1','W2','W3','W4','W5','W6','W7','W8']
    zone_names = [z['name'] for z in ZONES]
    random.seed(42)
    data = np.array([[random.uniform(-0.5, -8) for _ in weeks_h] for _ in zone_names])
    data[5] = [random.uniform(-1, -3) for _ in weeks_h]
    im = ax.imshow(data, aspect='auto', cmap='RdYlGn', vmin=-8, vmax=0)
    ax.set_xticks(range(len(weeks_h)))
    ax.set_xticklabels(weeks_h, fontsize=9)
    ax.set_yticks(range(len(zone_names)))
    ax.set_yticklabels(zone_names, fontsize=9)
    for i in range(len(zone_names)):
        for j in range(len(weeks_h)):
            ax.text(j, i, f'{data[i,j]:.1f}', ha='center', va='center', fontsize=7, color='#0D1B2A', fontweight='bold')
    cbar = fig.colorbar(im, ax=ax, orientation='vertical', pad=0.02, shrink=0.9)
    cbar.set_label('Volume Change (m3)', fontsize=8)
    ax.set_title('Volume Change Heatmap - Zones x Weeks (m3)', fontsize=11, fontweight='bold', color='#0D1B2A', pad=10)
    ax.set_facecolor('#FFF0F4F8')
    fig.tight_layout()
    return fig_to_image(fig)

def chart_donut():
    fig, ax = plt.subplots(figsize=(3.2, 3.2), facecolor='none')
    done = OVERALL_PCT
    left = 100 - done
    wedge_colors = ['#00C6A7', '#E8EEF4']
    wedges, _ = ax.pie([done, left], colors=wedge_colors, startangle=90, wedgeprops=dict(width=0.45, edgecolor='white', linewidth=2))
    ax.text(0, 0, f'{done:.1f}%', ha='center', va='center', fontsize=22, fontweight='bold', color='#0D1B2A')
    ax.text(0, -0.22, 'OVERALL', ha='center', va='center', fontsize=8, color='#8A9BB0', fontweight='bold')
    fig.tight_layout()
    return fig_to_image(fig, dpi=180)

class SectionHeader(Flowable):
    def __init__(self, number, title, page_width):
        super().__init__()
        self.number = number
        self.title  = title
        self.width  = page_width
    def wrap(self, avail_w, avail_h):
        return self.width, 28
    def draw(self):
        c = self.canv
        c.setFillColor(colors.navy)
        c.rect(0, 0, self.width, 28, fill=1, stroke=0)
        c.setFillColor(colors.white)
        c.rect(0, 0, 6, 28, fill=1, stroke=0)
        c.setFillColor(colors.white)
        c.setFont('Helvetica-Bold', 12)
        c.drawString(16, 9, f'{self.number}.  {self.title}')

def build():
    # תיקון נתיב יציאה לנתיב מקומי נוכחי כדי למנוע קריסה בווינדוס/לינוקס
    out = 'constrack_report.pdf'
    doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=18*mm, rightMargin=18*mm, topMargin=14*mm, bottomMargin=14*mm)
    styles = getSampleStyleSheet()
    
    # הגדרת סגנונות
    body = ParagraphStyle('body', fontName='Helvetica', fontSize=9.5, leading=14, textColor=rl_color(NAVY_HEX), spaceAfter=4)
    small = ParagraphStyle('small', fontName='Helvetica', fontSize=8.5, leading=12, textColor=rl_color(MID_GRAY))
    kv_key = ParagraphStyle('kk', fontName='Helvetica-Bold', fontSize=9, textColor=rl_color(STEEL_HEX))
    kv_val = ParagraphStyle('kv', fontName='Helvetica', fontSize=9, textColor=rl_color(NAVY_HEX))
    

    th_style = ParagraphStyle('th', fontName='Helvetica-Bold', fontSize=9, textColor=rl_color(WHITE))
    
    note_style = ParagraphStyle('note', fontName='Helvetica-Oblique', fontSize=8.5, textColor=rl_color(MID_GRAY), leading=12)
    content_width = W - 36*mm
    story = []

    class CoverBanner(Flowable):
        def wrap(self, aw, ah): return content_width, 110
        def draw(self):
            c = self.canv
            c.setFillColor(rl_color(NAVY_HEX))
            c.roundRect(0, 0, content_width, 110, 8, fill=1, stroke=0)
            c.setFillColor(rl_color(ACCENT_HEX))
            c.rect(0, 0, content_width, 5, fill=1, stroke=0)
            buf = chart_donut()
            img = ImageReader(buf)
            c.drawImage(img, 12, 15, width=80, height=80, mask='auto')
            c.setFillColor(rl_color(ACCENT_HEX))
            c.setFont('Helvetica-Bold', 28)
            c.drawString(108, 68, 'CONSTRACK')
            c.setFillColor(colors.white)
            c.setFont('Helvetica-Bold', 13)
            c.drawString(108, 48, 'PROGRESS REPORT')
            c.setFillColor(colors.HexColor("#8A9BB0"))
            c.setFont('Helvetica', 8.5)
            c.drawString(108, 33, f'Generated: {GENERATED[:10]}')
            c.drawString(108, 21, f'Run ID: {RUN_ID[:24]}...')

    story.append(CoverBanner())
    story.append(Spacer(1, 10))

    meta_rows = [['Run ID', RUN_ID], ['T1 Scan', T1_SCAN], ['T2 Scan', T2_SCAN], ['Alignment', ALIGNMENT], ['Forecast', FORECAST]]
    meta_table_data = [[Paragraph(k, kv_key), Paragraph(v, kv_val)] for k, v in meta_rows]
    meta_tbl = Table(meta_table_data, colWidths=[content_width*0.28, content_width*0.72])
    meta_tbl.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), rl_color(LIGHT_BG)),
        ('ROWBACKGROUNDS', (0,0), (-1,-1), [rl_color(LIGHT_BG), rl_color(WHITE)]),
        ('FONTNAME', (0,0), (-1,-1), 'Helvetica'),
        ('FONTSIZE', (0,0), (-1,-1), 9),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('BOX', (0,0), (-1,-1), 0.5, rl_color(MID_GRAY)),
        ('LINEBELOW', (0,0), (-1,-2), 0.3, colors.HexColor('#D0D8E4')),
    ]))
    story.append(meta_tbl)
    story.append(Spacer(1, 14))

    story.append(SectionHeader('1', 'Progress & Completion Percentages', content_width))
    story.append(Spacer(1, 8))

    cw = content_width / 4 - 3

    kpi_tbl = Table([[
        Table([[Paragraph(f'<font color="#00C6A7"><b>{OVERALL_PCT:.1f}%</b></font>', ParagraphStyle('k1', fontName='Helvetica-Bold', fontSize=22, textColor=rl_color(ACCENT_HEX), leading=26))], [Paragraph('Overall Progress', small)]], colWidths=[cw]),
        Table([[Paragraph(f'<b>{len(ZONES)}</b>', ParagraphStyle('k2', fontName='Helvetica-Bold', fontSize=22, textColor=rl_color(STEEL_HEX), leading=26))], [Paragraph('Active Zones', small)]], colWidths=[cw]),
        Table([[Paragraph(f'<font color="#F4A261"><b>{FORECAST}</b></font>', ParagraphStyle('k3', fontName='Helvetica-Bold', fontSize=16, textColor=rl_color(ACCENT2), leading=20))], [Paragraph('Est. Completion', small)]], colWidths=[cw]),
        Table([[Paragraph(f'<font color="#06D6A0"><b>{ALIGNMENT}</b></font>', ParagraphStyle('k4', fontName='Helvetica-Bold', fontSize=18, textColor=rl_color(GREEN_OK), leading=22))], [Paragraph('Alignment Quality', small)]], colWidths=[cw]),
    ]], colWidths=[cw+3]*4)
    kpi_tbl.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), rl_color(LIGHT_BG)),
        ('BOX', (0,0), (-1,-1), 0.4, rl_color(MID_GRAY)),
        ('INNERGRID', (0,0), (-1,-1), 0.4, colors.HexColor('#D0D8E4')),
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 10),
        ('BOTTOMPADDING', (0,0), (-1,-1), 10),
    ]))
    story.append(kpi_tbl)
    story.append(Spacer(1, 10))

    buf_zone = chart_zone_progress()
    story.append(Image(buf_zone, width=content_width, height=content_width * 0.46))
    story.append(Spacer(1, 8))


    zone_header = [Paragraph('<b>Zone</b>', th_style), Paragraph('<b>Type</b>', th_style), Paragraph('<b>Target %</b>', th_style), Paragraph('<b>Progress %</b>', th_style), Paragraph('<b>DeltaVol (m3)</b>', th_style), Paragraph('<b>Status</b>', th_style)]
    zone_rows = [zone_header]
    for z in ZONES:
        status = 'On Track' if z['progress'] >= z['completion'] else 'Delayed'
        sc = '#06D6A0' if status == 'On Track' else '#E63946'
        zone_rows.append([
            Paragraph(z['name'], body), Paragraph(z['type'], body),
            Paragraph(f"{z['completion']:.1f}%", body), Paragraph(f"<b>{z['progress']:.1f}%</b>", body),
            Paragraph(f"{z['vol']:.3f}", body), Paragraph(f'<font color="{sc}"><b>{status}</b></font>', body),
        ])
    zone_tbl = Table(zone_rows, colWidths=[content_width*w for w in [0.22, 0.13, 0.12, 0.14, 0.15, 0.14]])
    zone_tbl.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), rl_color(NAVY_HEX)),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [rl_color(WHITE), rl_color(LIGHT_BG)]),
        ('FONTNAME', (0,0), (-1,-1), 'Helvetica'), ('FONTSIZE', (0,0), (-1,-1), 8.5),
        ('TOPPADDING', (0,0), (-1,-1), 5), ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('LEFTPADDING', (0,0), (-1,-1), 6), ('BOX', (0,0), (-1,-1), 0.5, rl_color(MID_GRAY)),
        ('LINEBELOW', (0,0), (-1,-1), 0.3, colors.HexColor('#D0D8E4')),
        ('ALIGN', (2,0), (-1,-1), 'CENTER'),
    ]))
    story.append(zone_tbl)
    story.append(Spacer(1, 14))

    story.append(SectionHeader('2', 'Volume & Area Material Changes', content_width))
    story.append(Spacer(1, 8))

   
    vol_data = [
        [Paragraph('<b>Metric</b>', th_style), Paragraph('<b>Value</b>', th_style)],
        [Paragraph('Initial Volume - T1 Scan', body), Paragraph(f'{VOL_T1:.3f} m3', body)],
        [Paragraph('Current Volume - T2 Scan', body), Paragraph(f'{VOL_T2:.3f} m3', body)],
        [Paragraph('Net Volume Change (DeltaV)', body), Paragraph(f'<font color="#E63946"><b>{VOL_DELTA:.3f} m3</b></font>', body)],
        [Paragraph('Alignment Confidence', body), Paragraph(f'<font color="#00C6A7"><b>{ALIGNMENT}</b></font>', body)],
    ]
    vol_tbl = Table(vol_data, colWidths=[content_width*0.55, content_width*0.45])
    vol_tbl.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), rl_color(STEEL_HEX)),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [rl_color(WHITE), rl_color(LIGHT_BG)]),
        ('BOX', (0,0), (-1,-1), 0.5, rl_color(MID_GRAY)),
        ('LINEBELOW', (0,0), (-1,-1), 0.3, colors.HexColor('#D0D8E4')),
        ('TOPPADDING', (0,0), (-1,-1), 6), ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(vol_tbl)
    story.append(Spacer(1, 10))

    buf_heat = chart_heatmap()
    story.append(Image(buf_heat, width=content_width, height=content_width * 0.46))
    story.append(Spacer(1, 6))
    story.append(Paragraph('* Heatmap shows weekly volume removal per zone (m3). Green = high activity, Red = low activity.', note_style))
    story.append(Spacer(1, 14))

    story.append(SectionHeader('3', 'Forecast Completion Estimation', content_width))
    story.append(Spacer(1, 8))
    gap = TIMELINE['cumPlan'][-1] - TIMELINE['cumActual'][-1]
    forecast_text = (f'Based on current site velocity and the observed work rate of <b>{TIMELINE["actual"][-1]:.1f}% per week</b>, the project is estimated to reach full completion on <font color="#F4A261"><b>{FORECAST}</b></font>. The current trajectory shows a <b>{gap:.1f}% gap</b> vs. the planned schedule, primarily concentrated in the South Block and Central Hub zones.')
    story.append(Paragraph(forecast_text, body))
    story.append(Spacer(1, 14))

    story.append(SectionHeader('4', 'Work Rate Trends & Analytics', content_width))
    story.append(Spacer(1, 8))
    buf_cum  = chart_cumulative()
    buf_rate = chart_workrate()
    story.append(Image(buf_cum,  width=content_width, height=content_width * 0.46))
    story.append(Spacer(1, 8))
    story.append(Image(buf_rate, width=content_width, height=content_width * 0.43))
    story.append(Spacer(1, 6))
    story.append(Paragraph('* Charts reflect data from T1 to T2 scan window. Interactive dashboards with live filters are available in the web platform.', note_style))

    story.append(Spacer(1, 16))
    story.append(HRFlowable(width=content_width, thickness=1, color=rl_color(ACCENT_HEX), spaceAfter=6))
    story.append(Paragraph(f'CONSTRACK Automated Report  -  Run {RUN_ID[:16]}...  -  {GENERATED[:10]}  -  Confidential - For internal use only.',
        ParagraphStyle('footer', fontName='Helvetica', fontSize=7.5, textColor=rl_color(MID_GRAY), alignment=TA_CENTER)))

    
    doc.build(story)
    print('PDF generated successfully')


    from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side, GradientFill
from openpyxl.utils import get_column_letter
from openpyxl.chart import BarChart, LineChart, Reference
from openpyxl.chart.series import DataPoint


def hdr(text, bold=True, color=WHITE, sz=11, bg=None):
    cell_font = Font(name='Arial', bold=bold, color=color, size=sz)
    fill = PatternFill('solid', fgColor=bg) if bg else PatternFill()
    return cell_font, fill

def style_cell(ws, row, col, value=None, bold=False, font_color="000000",
               bg=None, align='left', size=10, border=True, number_format=None):
    cell = ws.cell(row=row, column=col)
    if value is not None:
        cell.value = value
    cell.font = Font(name='Arial', bold=bold, color=font_color, size=size)
    if bg:
        cell.fill = PatternFill('solid', fgColor=bg)
    cell.alignment = Alignment(horizontal=align, vertical='center', wrap_text=True)
    if border:
        thin = Side(style='thin', color='D0D8E4')
        cell.border = Border(left=thin, right=thin, top=thin, bottom=thin)
    if number_format:
        cell.number_format = number_format
    return cell

def merge_title(ws, row, col_start, col_end, text, bg=NAVY_HEX, fg=WHITE, sz=12):
    ws.merge_cells(start_row=row, start_column=col_start, end_row=row, end_column=col_end)
    cell = ws.cell(row=row, column=col_start)
    cell.value = text
    cell.font = Font(name='Arial', bold=True, color=fg, size=sz)
    cell.fill = PatternFill('solid', fgColor=bg)
    cell.alignment = Alignment(horizontal='left', vertical='center')

# ── DATA ────────────────────────────────────────────────────────────────────
RUN_ID      = '665f1c2d3e4f5a6b7c8d9e0f'
GENERATED   = '2026-06-05'
T1_SCAN     = 'scan_early_2026'
T2_SCAN     = 'scan_later_2026'
OVERALL_PCT = 65.5
VOL_T1      = 150.450
VOL_T2      = 120.150
VOL_DELTA   = -30.300
FORECAST    = '2026-08-15'
ALIGNMENT   = 'HIGH'

ZONES = [
    {'name': 'North Wing',     'type': 'Structure', 'completion': 72.0, 'progress': 80.0, 'vol': -20.100},
    {'name': 'South Block',    'type': 'Foundation','completion': 45.0, 'progress': 45.2, 'vol': -10.200},
    {'name': 'East Corridor',  'type': 'Frame',     'completion': 60.0, 'progress': 68.0, 'vol': -5.800},
    {'name': 'West Annex',     'type': 'Structure', 'completion': 55.0, 'progress': 58.5, 'vol': -7.400},
    {'name': 'Central Hub',    'type': 'Interior',  'completion': 30.0, 'progress': 35.0, 'vol': -3.200},
    {'name': 'Roof Section A', 'type': 'Roofing',   'completion': 88.0, 'progress': 91.0, 'vol': -8.600},
]

WEEKS   = ['W1','W2','W3','W4','W5','W6','W7','W8']
ACTUAL  = [5.2, 6.8, 7.1, 8.4, 9.0, 10.2, 11.5, 12.3]
PLANNED = [6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0]
CUM_A   = [5.2,12.0,19.1,27.5,36.5,46.7,58.2,65.5]
CUM_P   = [6.0,13.0,21.0,30.0,40.0,51.0,63.0,76.0]

import random
random.seed(42)
HEATMAP = [[round(random.uniform(-0.5,-8),1) for _ in WEEKS] for _ in ZONES]
HEATMAP[5] = [round(random.uniform(-1,-3),1) for _ in WEEKS]

wb = Workbook()
wb.remove(wb.active)

# ═══════════════════════════════════════════════════════════════
# SHEET 1 — OVERVIEW
# ═══════════════════════════════════════════════════════════════
ws1 = wb.create_sheet("Overview")
ws1.sheet_view.showGridLines = False
ws1.column_dimensions['A'].width = 26
ws1.column_dimensions['B'].width = 28
ws1.column_dimensions['C'].width = 18
ws1.column_dimensions['D'].width = 18
ws1.column_dimensions['E'].width = 18
ws1.column_dimensions['F'].width = 18
ws1.row_dimensions[1].height = 40
ws1.row_dimensions[2].height = 6

# Banner
ws1.merge_cells('A1:F1')
c = ws1['A1']
c.value = '  CONSTRACK — PROGRESS REPORT'
c.font = Font(name='Arial', bold=True, color=ACCENT_HEX, size=22)
c.fill = PatternFill('solid', fgColor=NAVY_HEX)
c.alignment = Alignment(horizontal='left', vertical='center')

# Sub-banner info row
ws1.merge_cells('A3:F3')
info = ws1['A3']
info.value = f'  Generated: {GENERATED}   |   Run ID: {RUN_ID}   |   Alignment: {ALIGNMENT}   |   Forecast: {FORECAST}'
info.font = Font(name='Arial', color=MID_GRAY, size=9)
info.fill = PatternFill('solid', fgColor="E8EEF4")
info.alignment = Alignment(horizontal='left', vertical='center')
ws1.row_dimensions[3].height = 18

# KPI Cards (row 5–7)
ws1.row_dimensions[5].height = 8
kpis = [
    ('Overall Progress', f'{OVERALL_PCT:.1f}%', ACCENT_HEX),
    ('Active Zones', str(len(ZONES)), STEEL_HEX),
    ('Est. Completion', FORECAST, ACCENT2),
    ('Alignment', ALIGNMENT, GREEN_OK),
]
ws1.row_dimensions[6].height = 36
ws1.row_dimensions[7].height = 20
ws1.row_dimensions[8].height = 8
for i, (label, value, color) in enumerate(kpis, start=3):
    col = i
    style_cell(ws1, 6, col, value=value, bold=True, font_color=color, bg=LIGHT_BG, align='center', size=16, border=False)
    style_cell(ws1, 7, col, value=label, bold=False, font_color=MID_GRAY, bg=LIGHT_BG, align='center', size=9, border=False)
    # Add bottom accent line
    thin_accent = Side(style='medium', color=color)
    ws1.cell(row=6, column=col).border = Border(bottom=thin_accent)

# Section: Run Metadata (row 10+)
merge_title(ws1, 10, 1, 6, '  Run Metadata', bg=STEEL_HEX)
ws1.row_dimensions[10].height = 22
meta = [('Run ID', RUN_ID), ('T1 Scan', T1_SCAN), ('T2 Scan', T2_SCAN),
        ('Alignment', ALIGNMENT), ('Forecast', FORECAST), ('Generated', GENERATED)]
for i, (k, v) in enumerate(meta, start=11):
    ws1.row_dimensions[i].height = 18
    style_cell(ws1, i, 1, value=k, bold=True, font_color=STEEL_HEX, bg=LIGHT_BG if i%2==0 else WHITE, size=9)
    style_cell(ws1, i, 2, value=v, bold=False, font_color=NAVY_HEX, bg=LIGHT_BG if i%2==0 else WHITE, size=9)

# Section: Volume Summary (row 19+)
merge_title(ws1, 19, 1, 6, '  Volume Summary', bg=STEEL_HEX)
ws1.row_dimensions[19].height = 22
vol_data = [
    ('Initial Volume (T1 Scan)', VOL_T1, 'm³'),
    ('Current Volume (T2 Scan)', VOL_T2, 'm³'),
    ('Net Volume Change (ΔV)', VOL_DELTA, 'm³'),
]
for i, (label, val, unit) in enumerate(vol_data, start=20):
    ws1.row_dimensions[i].height = 18
    bg = LIGHT_BG if i%2==0 else WHITE
    style_cell(ws1, i, 1, value=label, bold=False, font_color=NAVY_HEX, bg=bg, size=9)
    fc = RED_ZONE if val < 0 else NAVY_HEX
    style_cell(ws1, i, 2, value=val, bold=True, font_color=fc, bg=bg, size=10, number_format='#,##0.000')
    style_cell(ws1, i, 3, value=unit, bold=False, font_color=MID_GRAY, bg=bg, size=9)

# ═══════════════════════════════════════════════════════════════
# SHEET 2 — ZONE PROGRESS
# ═══════════════════════════════════════════════════════════════
ws2 = wb.create_sheet("Zone Progress")
ws2.sheet_view.showGridLines = False
for col, w in zip(['A','B','C','D','E','F','G'], [20,14,14,14,16,14,14]):
    ws2.column_dimensions[col].width = w

# Title
ws2.merge_cells('A1:G1')
c = ws2['A1']
c.value = '  ZONE PROGRESS & STATUS'
c.font = Font(name='Arial', bold=True, color=ACCENT_HEX, size=16)
c.fill = PatternFill('solid', fgColor=NAVY_HEX)
c.alignment = Alignment(horizontal='left', vertical='center')
ws2.row_dimensions[1].height = 32

# Header row
headers = ['Zone', 'Type', 'Target %', 'Progress %', 'ΔVol (m³)', 'Status', 'Gap']
for col, h in enumerate(headers, 1):
    style_cell(ws2, 3, col, value=h, bold=True, font_color=WHITE, bg=NAVY_HEX, align='center', size=10)
ws2.row_dimensions[3].height = 22

# Data rows
for i, z in enumerate(ZONES, start=4):
    status = 'On Track' if z['progress'] >= z['completion'] else 'Delayed'
    status_color = GREEN_OK if status == 'On Track' else RED_ZONE
    bg = LIGHT_BG if i%2==0 else WHITE
    gap = z['progress'] - z['completion']

    style_cell(ws2, i, 1, value=z['name'],        bold=True,  font_color=NAVY_HEX, bg=bg, size=9)
    style_cell(ws2, i, 2, value=z['type'],         bold=False, font_color=MID_GRAY, bg=bg, size=9, align='center')
    style_cell(ws2, i, 3, value=z['completion']/100, bold=False, font_color=STEEL_HEX, bg=bg, size=10, align='center', number_format='0.0%')
    style_cell(ws2, i, 4, value=z['progress']/100,  bold=True,  font_color=ACCENT_HEX, bg=bg, size=10, align='center', number_format='0.0%')
    style_cell(ws2, i, 5, value=z['vol'],           bold=False, font_color=RED_ZONE, bg=bg, size=9, align='center', number_format='#,##0.000')
    style_cell(ws2, i, 6, value=status,             bold=True,  font_color=status_color, bg=bg, size=9, align='center')
    style_cell(ws2, i, 7, value=gap/100,            bold=False, font_color=GREEN_OK if gap>=0 else RED_ZONE, bg=bg, size=9, align='center', number_format='+0.0%;-0.0%')
    ws2.row_dimensions[i].height = 18

# Summary formula row
sr = len(ZONES) + 5
ws2.row_dimensions[sr].height = 20
style_cell(ws2, sr, 1, value='AVERAGE', bold=True, font_color=WHITE, bg=STEEL_HEX, align='center')
for col, formula in [(3, f'=AVERAGE(C4:C{sr-1})'), (4, f'=AVERAGE(D4:D{sr-1})'),
                     (5, f'=SUM(E4:E{sr-1})'), (7, f'=AVERAGE(G4:G{sr-1})')]:
    c = ws2.cell(row=sr, column=col)
    c.value = formula
    c.font = Font(name='Arial', bold=True, color=WHITE, size=10)
    c.fill = PatternFill('solid', fgColor=STEEL_HEX)
    c.alignment = Alignment(horizontal='center', vertical='center')
    c.number_format = '0.0%' if col != 5 else '#,##0.000'
    thin = Side(style='thin', color='FFFFFF')
    c.border = Border(left=thin, right=thin, top=thin, bottom=thin)

# ═══════════════════════════════════════════════════════════════
# SHEET 3 — TIMELINE & WORK RATE
# ═══════════════════════════════════════════════════════════════
ws3 = wb.create_sheet("Timeline & Work Rate")
ws3.sheet_view.showGridLines = False
for col, w in zip(['A','B','C','D','E'], [14,14,14,14,18]):
    ws3.column_dimensions[col].width = w

ws3.merge_cells('A1:E1')
c = ws3['A1']
c.value = '  TIMELINE & WORK RATE ANALYTICS'
c.font = Font(name='Arial', bold=True, color=ACCENT_HEX, size=16)
c.fill = PatternFill('solid', fgColor=NAVY_HEX)
c.alignment = Alignment(horizontal='left', vertical='center')
ws3.row_dimensions[1].height = 32

# Section title
merge_title(ws3, 3, 1, 5, '  Weekly & Cumulative Progress', bg=STEEL_HEX, sz=10)
ws3.row_dimensions[3].height = 20

# Headers
hdrs = ['Week', 'Planned %', 'Actual %', 'Cum. Planned', 'Cum. Actual']
for col, h in enumerate(hdrs, 1):
    style_cell(ws3, 4, col, value=h, bold=True, font_color=WHITE, bg=NAVY_HEX, align='center', size=10)
ws3.row_dimensions[4].height = 20

for i, (wk, pl, ac, cp, ca) in enumerate(zip(WEEKS, PLANNED, ACTUAL, CUM_P, CUM_A), start=5):
    bg = LIGHT_BG if i%2==0 else WHITE
    style_cell(ws3, i, 1, value=wk, bold=True, font_color=NAVY_HEX, bg=bg, align='center', size=10)
    style_cell(ws3, i, 2, value=pl/100, bold=False, font_color=STEEL_HEX, bg=bg, align='center', number_format='0.0%')
    ac_color = GREEN_OK if ac >= pl else RED_ZONE
    style_cell(ws3, i, 3, value=ac/100, bold=True, font_color=ac_color, bg=bg, align='center', number_format='0.0%')
    style_cell(ws3, i, 4, value=cp/100, bold=False, font_color=STEEL_HEX, bg=bg, align='center', number_format='0.0%')
    style_cell(ws3, i, 5, value=ca/100, bold=True, font_color=ACCENT_HEX, bg=bg, align='center', number_format='0.0%')
    ws3.row_dimensions[i].height = 18

# Summary formulas
sr3 = 5 + len(WEEKS)
ws3.row_dimensions[sr3].height = 20
style_cell(ws3, sr3, 1, value='TOTAL/AVG', bold=True, font_color=WHITE, bg=STEEL_HEX, align='center')
for col, formula, fmt in [
    (2, f'=AVERAGE(B5:B{sr3-1})', '0.0%'),
    (3, f'=AVERAGE(C5:C{sr3-1})', '0.0%'),
    (4, f'=MAX(D5:D{sr3-1})', '0.0%'),
    (5, f'=MAX(E5:E{sr3-1})', '0.0%'),
]:
    c = ws3.cell(row=sr3, column=col)
    c.value = formula
    c.font = Font(name='Arial', bold=True, color=WHITE, size=10)
    c.fill = PatternFill('solid', fgColor=STEEL_HEX)
    c.alignment = Alignment(horizontal='center', vertical='center')
    c.number_format = fmt

# Gap analysis section
gap_row = sr3 + 2
merge_title(ws3, gap_row, 1, 5, '  Schedule Gap Analysis', bg=STEEL_HEX, sz=10)
ws3.row_dimensions[gap_row].height = 20
gap_headers = ['Week', 'Planned', 'Actual', 'Gap', 'Gap %']
for col, h in enumerate(gap_headers, 1):
    style_cell(ws3, gap_row+1, col, value=h, bold=True, font_color=WHITE, bg=NAVY_HEX, align='center', size=10)
for i, (wk, cp, ca) in enumerate(zip(WEEKS, CUM_P, CUM_A), start=gap_row+2):
    bg = LIGHT_BG if i%2==0 else WHITE
    row = i
    style_cell(ws3, row, 1, value=wk, bold=True, font_color=NAVY_HEX, bg=bg, align='center')
    style_cell(ws3, row, 2, value=cp/100, bg=bg, align='center', number_format='0.0%')
    style_cell(ws3, row, 3, value=ca/100, bg=bg, align='center', number_format='0.0%', font_color=ACCENT_HEX)
    gap_val = (ca - cp) / 100
    gc = GREEN_OK if gap_val >= 0 else RED_ZONE
    c4 = ws3.cell(row=row, column=4)
    c4.value = gap_val
    c4.font = Font(name='Arial', bold=True, color=gc, size=10)
    c4.fill = PatternFill('solid', fgColor=bg)
    c4.alignment = Alignment(horizontal='center', vertical='center')
    c4.number_format = '+0.0%;-0.0%'
    style_cell(ws3, row, 5, value=f'={get_column_letter(4)}{row}/{get_column_letter(2)}{row}', bg=bg, align='center', number_format='0.0%', font_color=gc)
    ws3.row_dimensions[row].height = 18

# ═══════════════════════════════════════════════════════════════
# SHEET 4 — VOLUME HEATMAP
# ═══════════════════════════════════════════════════════════════
ws4 = wb.create_sheet("Volume Heatmap")
ws4.sheet_view.showGridLines = False
ws4.column_dimensions['A'].width = 18
for col_idx in range(2, 10):
    ws4.column_dimensions[get_column_letter(col_idx)].width = 10

ws4.merge_cells('A1:I1')
c = ws4['A1']
c.value = '  VOLUME CHANGE HEATMAP (m³) — ZONES × WEEKS'
c.font = Font(name='Arial', bold=True, color=ACCENT_HEX, size=16)
c.fill = PatternFill('solid', fgColor=NAVY_HEX)
c.alignment = Alignment(horizontal='left', vertical='center')
ws4.row_dimensions[1].height = 32

# Headers
style_cell(ws4, 3, 1, value='Zone / Week', bold=True, font_color=WHITE, bg=NAVY_HEX, align='center')
for j, wk in enumerate(WEEKS, start=2):
    style_cell(ws4, 3, j, value=wk, bold=True, font_color=WHITE, bg=NAVY_HEX, align='center')
ws4.row_dimensions[3].height = 20

# Heatmap color scale: interpolate between RED and GREEN based on value
def heat_color(val, vmin=-8, vmax=0):
    # val close to 0 = green, val close to -8 = red
    t = (val - vmin) / (vmax - vmin)  # 0=red, 1=green
    r = int(230 * (1-t) + 6 * t)
    g = int(57 * (1-t) + 214 * t)
    b = int(70 * (1-t) + 160 * t)
    return f"{r:02X}{g:02X}{b:02X}"

for i, (zone, row_data) in enumerate(zip(ZONES, HEATMAP), start=4):
    bg = LIGHT_BG if i%2==0 else WHITE
    style_cell(ws4, i, 1, value=zone['name'], bold=True, font_color=NAVY_HEX, bg=bg, size=9)
    for j, val in enumerate(row_data, start=2):
        hex_bg = heat_color(val)
        c = ws4.cell(row=i, column=j)
        c.value = val
        c.font = Font(name='Arial', bold=True, color=NAVY_HEX, size=9)
        c.fill = PatternFill('solid', fgColor=hex_bg)
        c.alignment = Alignment(horizontal='center', vertical='center')
        thin = Side(style='thin', color='FFFFFF')
        c.border = Border(left=thin, right=thin, top=thin, bottom=thin)
        c.number_format = '0.0'
    ws4.row_dimensions[i].height = 20

# Row totals
total_row = 4 + len(ZONES)
ws4.row_dimensions[total_row].height = 20
style_cell(ws4, total_row, 1, value='TOTAL', bold=True, font_color=WHITE, bg=STEEL_HEX, align='center')
for j in range(2, len(WEEKS)+2):
    col_letter = get_column_letter(j)
    c = ws4.cell(row=total_row, column=j)
    c.value = f'=SUM({col_letter}4:{col_letter}{total_row-1})'
    c.font = Font(name='Arial', bold=True, color=WHITE, size=10)
    c.fill = PatternFill('solid', fgColor=STEEL_HEX)
    c.alignment = Alignment(horizontal='center', vertical='center')
    c.number_format = '#,##0.0'

# Legend
legend_row = total_row + 2
ws4.merge_cells(f'A{legend_row}:D{legend_row}')
c = ws4.cell(row=legend_row, column=1)
c.value = 'Color Scale: Red = Low Activity (-8 m³) → Green = High Activity (0 m³)'
c.font = Font(name='Arial', italic=True, color=MID_GRAY, size=8)
c.alignment = Alignment(horizontal='left', vertical='center')

# ═══════════════════════════════════════════════════════════════
# FREEZE PANES & TAB COLORS
# ═══════════════════════════════════════════════════════════════
ws1.freeze_panes = 'A4'
ws2.freeze_panes = 'A4'
ws3.freeze_panes = 'A5'
ws4.freeze_panes = 'B4'

ws1.sheet_properties.tabColor = ACCENT_HEX
ws2.sheet_properties.tabColor = STEEL_HEX
ws3.sheet_properties.tabColor = ACCENT2
ws4.sheet_properties.tabColor = RED_ZONE

out = "constrack_report.xlsx"
wb.save(out)
print('Excel saved')

if __name__ == '__main__':
    build()