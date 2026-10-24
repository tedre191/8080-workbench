; Cracktro: a plasma and a keygen tune, the way old cracktros did it.
;
;   Display   a sine plasma that flashes on the kick drum
;   Sound     a chiptune on three voices, in stereo: fast arpeggios for the
;             chords bouncing between the speakers, a bass in the middle,
;             and drums
;   Timer     50 ticks a second drive the music, like the C64 and Amiga
;             players that ran off the screen's refresh
;   LEDs      a beat meter
;   Terminal  the greetings
;
; The music plays in the timer interrupt, so it keeps time while the main
; program draws the plasma as fast as it can. The plasma's inner loop
; rewrites one of its own instructions for each row: see `rowadd`.
;
; Run it at 2 MHz or Max. The timer keeps real time at every speed, and at
; 30 Hz and 500 Hz it ticks again before the music player has finished.

DATA     EQU 11h
LEDS     EQU 20h
TIMER    EQU 30h
ARP      EQU 40h            ; the sound chip's voices: each has four ports,
BASSV    EQU 44h            ; +0 MIDI note (69 = A 440 Hz, 0 = off),
DRUM     EQU 48h            ; +1 waveform, +2 volume (0-15), +3 pan
SQUARE   EQU 0              ; waveforms
SAW      EQU 2
NOISE    EQU 3
LEFT     EQU 0C0h           ; pans: a signed byte, 80h far left, 7Fh far right
RIGHT    EQU 40h
VRAM     EQU 0F000h
COLX     EQU 9000h          ; this frame's plasma value for each column

TICKS    EQU 6              ; ticks per row: 6 x 20 ms = 120 ms, 125 BPM
KICK     EQU 1              ; what each row of the tune plays (see `rows`)
SNARE    EQU 2
BASS     EQU 4
HAT      EQU 8

        ORG 0
        JMP main

        ORG 08h             ; RST 1: the timer ticked
        JMP music

main:   LXI SP, 0E000h
        LXI H, greets
        CALL puts
        MVI A, 9            ; the arpeggio: a square wave, not too loud
        OUT ARP+2
        MVI A, SAW          ; the bass: a sawtooth
        OUT BASSV+1
        MVI A, 20           ; tick every 20 ms
        OUT TIMER
        EI

; The plasma. Each pixel's colour is a column value plus a row value, both
; sums of sines that drift with time, looked up in a colour ramp. Each row
; also starts a sine's worth further along the column values, so the rows
; wobble sideways instead of making a grid.
frame:  LDA clock           ; time moves with the timer, so the plasma
        ORA A               ; runs at the same pace at any speed
        RAR
        STA q1              ; the row phases start from it
        ADD A
        STA q2
        MOV B, A            ; column phases: B = 2t, C = -t
        RAR
        CMA
        INR A
        MOV C, A
        MVI H, HIGH sine
        LXI D, COLX
col:    MOV A, B            ; COLX[x] = sine[B] + sine[C]
        ANI 63
        MOV L, A
        MOV A, M
        STAX D
        MOV A, C
        ANI 63
        MOV L, A
        LDAX D
        ADD M
        STAX D
        INR B               ; B steps 1 and C steps 2 per column
        INR C
        INR C
        INR E
        MOV A, E
        CPI 64              ; 32 columns, and as many again for the wobble
        JNZ col

        LXI H, VRAM
row:    PUSH H              ; this row's value: 2 sine[q1] + sine[q2] + flash
        MVI H, HIGH sine
        LDA q1
        ADI 2
        STA q1
        ANI 63
        MOV L, A
        MOV A, M
        ADD A
        MOV E, A            ; E = 2 sine[q1], also how far the row shifts
        LDA q2
        DCR A
        STA q2
        ANI 63
        MOV L, A
        MOV A, M
        ADD E
        LXI H, flash
        ADD M
        STA rowadd+1        ; patch it into the ADI below
        POP H
        MVI D, HIGH COLX    ; DE = COLX + the shift
        MVI B, HIGH ramp
pixel:  LDAX D              ; A = this column's value
rowadd: ADI 0               ; + this row's (rewritten for each row)
        ANI 15
        MOV C, A
        LDAX B              ; look the colour up in the ramp
        MOV M, A
        INX H
        INR E
        MOV A, L            ; the end of the row?
        ANI 31
        JNZ pixel
        MOV A, H            ; all 32 rows done when HL reaches F400h
        CPI HIGH (VRAM + 32*32)
        JNZ row
        JMP frame

; The music player, called by the timer 50 times a second. It saves every
; register, since it interrupts the plasma anywhere.
music:  PUSH PSW
        PUSH B
        PUSH D
        PUSH H
        LDA clock
        INR A
        STA clock
        LDA tick            ; next tick; every TICKS ticks, the next row,
        INR A               ; and every 16 rows the next bar
        CPI TICKS
        JC mu2
        LDA rown
        INR A
        ANI 15
        STA rown
        JNZ mu1
        LDA bar
        INR A
        ANI 3
        STA bar
mu1:    XRA A
mu2:    STA tick
        CALL getrow
        CALL playarp
        CALL playbass
        CALL playdrums
        CALL fade
        POP H
        POP D
        POP B
        POP PSW
        EI
        RET

; flags = what this row plays. The last bar ends with a snare fill.
getrow: LDA rown
        MOV E, A
        MVI D, 0
        LXI H, rows
        DAD D
        MOV B, M
        LDA bar
        CPI 3
        JNZ gr1
        MOV A, E
        CPI 12
        JC gr1
        MOV A, B
        ANI BASS
        ORI SNARE
        MOV B, A
gr1:    MOV A, B
        STA flags
        RET

; Voice 0, the arpeggio: the chord's root, third and fifth, a tick each,
; twice a row. Each row lifts it by its own amount, which turns the chords
; into a riff, and each row it moves to the other speaker.
playarp:
        LDA tick
        ORA A
        JNZ ar0
        LDA rown            ; a new row: even rows left, odd rows right
        RRC
        MVI A, LEFT
        JNC pan
        MVI A, RIGHT
pan:    OUT ARP+3
ar0:    LDA bar
        MOV E, A
        MVI D, 0
        LXI H, third
        DAD D
        MOV B, M            ; B = 3 (minor) or 4 (major)
        LXI H, chord
        DAD D
        MOV A, M
        PUSH PSW            ; the root
        LDA rown
        MOV E, A
        LXI H, lift
        DAD D
        POP PSW
        ADD M               ; + this row's lift
        MOV E, A            ; E = the arpeggio's root
        LDA tick            ; which note: tick mod 3
        CPI 3
        JC ar1
        SUI 3
ar1:    MOV C, A
        MOV A, E            ; the root (MOV leaves the flags alone)
        DCR C
        JM ar2
        ADD B               ; the third
        DCR C
        JM ar2
        SUB B               ; the fifth
        ADI 7
ar2:    OUT ARP
        RET

; Voice 1, the bass: a sawtooth that starts loud on its rows and fades
; until the next.
playbass:
        LDA tick
        ORA A
        JNZ bs1
        LDA flags
        ANI BASS
        JZ bs1
        LDA bar             ; a new note: this bar's
        MOV E, A
        MVI D, 0
        LXI H, bassn
        DAD D
        MOV A, M
        OUT BASSV
        MVI A, 14
        STA bassvol
bs1:    LDA bassvol         ; each tick it fades a little, down to 4
        OUT BASSV+2
        CPI 5
        RC
        DCR A
        STA bassvol
        RET

; Voice 2, the drums: each takes the first tick or two of its row.
playdrums:
        LDA tick
        CPI 2
        JNC quiet
        MOV C, A            ; C = tick in the row
        LDA flags
        MOV B, A
        ANI KICK
        JNZ kickdrum
        MOV A, B
        ANI SNARE
        JNZ snaredrum
        MOV A, B
        ANI HAT
        RZ
        MOV A, C            ; the hi-hat: one tick of quiet, high noise
        ORA A
        JNZ quiet
        MVI A, NOISE
        OUT DRUM+1
        MVI A, 4
        OUT DRUM+2
        MVI A, 127
        OUT DRUM
        RET
quiet:  XRA A
        OUT DRUM
        RET

; The kick: a square wave falling an octave. Its first tick flashes the
; plasma and fills the beat meter.
kickdrum:
        MVI A, SQUARE
        OUT DRUM+1
        MVI A, 15
        OUT DRUM+2
        MOV A, C
        ORA A
        MVI A, 45
        JZ ki1
        MVI A, 33
ki1:    OUT DRUM
        MOV A, C
        ORA A
        RNZ
        MVI A, 8
        STA flash
        MVI A, 0FFh
        STA beat
        RET

; The snare: a burst of noise.
snaredrum:
        MVI A, NOISE
        OUT DRUM+1
        MOV A, C
        ORA A
        MVI A, 13
        JZ sn1
        MVI A, 6
sn1:    OUT DRUM+2
        MVI A, 100          ; high enough to play the noise at full speed
        OUT DRUM
        RET

; Each tick, the beat meter drops a LED and the flash fades.
fade:   LDA beat
        ORA A               ; clear carry
        RAR
        STA beat
        OUT LEDS
        LDA flash
        SUI 2
        RC
        STA flash
        RET

; Print the zero-terminated string at HL.
puts:   MOV A, M
        ORA A
        RZ
        OUT DATA
        INX H
        JMP puts

; The tune: Am, F, C, G, a bar each (the progression of a thousand songs).
chord:  DB 69, 65, 72, 67   ; the chords' roots: A4, F4, C5, G4
third:  DB 3, 4, 4, 4       ; minor, major, major, major
bassn:  DB 45, 41, 48, 43   ; the bass: A2, F2, C3, G2
rows:   DB KICK+BASS, HAT, HAT, BASS+HAT, SNARE, HAT, KICK+BASS, HAT
        DB KICK+BASS, HAT, BASS+HAT, HAT, SNARE, HAT, BASS+HAT, HAT
lift:   DB 0, 0, 12, 0, 0, 12, 0, 7     ; semitones each row lifts the arpeggio
        DB 0, 12, 0, 7, 12, 0, 0, 12

greets: DB 12, 10
        DB "  +--------------------------------------+", 10
        DB "  |     8 0 8 0   W O R K B E N C H      |", 10
        DB "  |            p r e s e n t s           |", 10
        DB "  |        a 2 MHz cracktro, live        |", 10
        DB "  +--------------------------------------+", 10, 10
        DB "  Three voices, no samples: the chords are", 10
        DB "  arpeggios bouncing between the speakers,", 10
        DB "  over a bass and a drum machine.", 10, 10
        DB "  Greetings to Intel, MITS, Digital Research", 10
        DB "  and every scener who ever squeezed a chord", 10
        DB "  out of a sound chip.", 10, 0

; Variables
clock:  DB 0                ; timer ticks, for the plasma's time
tick:   DB TICKS - 1        ; start just before row 0 of bar 0
rown:   DB 15
bar:    DB 3
flags:  DB 0                ; what the current row plays
bassvol:
        DB 4
beat:   DB 0                ; the beat meter's LEDs
flash:  DB 0                ; added to every colour, for a moment, on a kick
q1:     DB 0                ; row phases
q2:     DB 0

; Tables that need a page of their own, so one register can index them.
        ORG ($ + 0FFh) & 0FF00h
sine:   DB 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 7, 7, 7, 7, 7
        DB 7, 7, 7, 7, 7, 7, 6, 6, 6, 6, 5, 5, 5, 5, 4, 4
        DB 4, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0
        DB 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3
        ORG ($ + 0FFh) & 0FF00h
; The colour ramp: black, blue, cyan, white, yellow, red, and back again,
; so even where it wraps around the colours are neighbours.
ramp:   DB 0, 1, 9, 11, 15, 14, 12, 4, 4, 12, 14, 15, 11, 9, 1, 0
