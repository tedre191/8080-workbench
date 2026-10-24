; Cracktro: a plasma and a keygen tune, the way old cracktros did it.
;
;   Display   a sine plasma that flashes on the kick drum
;   Sound     a chiptune on one voice: fast arpeggios for the chords, a
;             bass, and drums squeezed in between
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
NOTE     EQU 40h            ; sound: MIDI note (69 = A 440 Hz), 0 = off
WAVE     EQU 41h
VOLUME   EQU 42h            ; 0-15
SQUARE   EQU 0              ; waveforms
SAW      EQU 2
NOISE    EQU 3
VRAM     EQU 0F000h
COLX     EQU 9000h          ; this frame's plasma value for each column

TICKS    EQU 6              ; ticks per row: 6 x 20 ms = 120 ms, 125 BPM
KICK     EQU 1              ; what each row of the tune plays (see `rows`)
SNARE    EQU 2
BASS     EQU 4

        ORG 0
        JMP main

        ORG 08h             ; RST 1: the timer ticked
        JMP music

main:   LXI SP, 0E000h
        LXI H, greets
        CALL puts
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
        CALL voice
        CALL fade
        POP H
        POP D
        POP B
        POP PSW
        EI
        RET

; Play this tick of the current row. A drum takes the row's first two
; ticks; the bass or the arpeggio plays the rest.
voice:  LDA rown
        MOV E, A
        MVI D, 0
        LXI H, rows
        DAD D
        MOV B, M            ; B = what this row plays
        LDA bar             ; the last bar ends with a snare fill
        CPI 3
        JNZ vo1
        MOV A, E
        CPI 12
        JC vo1
        MOV A, B
        ANI BASS
        ORI SNARE
        MOV B, A
vo1:    LDA bar
        MOV E, A            ; DE = bar, to look up its chord
        LDA tick
        MOV C, A            ; C = tick in the row
        CPI 2
        JNC inst
        MOV A, B
        ANI KICK
        JNZ kickdrum
        MOV A, B
        ANI SNARE
        JNZ snaredrum
inst:   MOV A, B
        ANI BASS
        JNZ bassnote

; An arpeggio: the chord's root, third and fifth, a tick each, twice.
; Each row lifts it by its own amount, which turns the chords into a riff.
arp:    MVI A, SQUARE
        OUT WAVE
        MVI A, 10
        OUT VOLUME
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
        MOV A, C            ; which note: tick mod 3
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
ar2:    OUT NOTE
        RET

; The bass: a sawtooth, plucked, so it fades through the row.
bassnote:
        MVI A, SAW
        OUT WAVE
        MVI A, 14
        SUB C
        SUB C
        OUT VOLUME
        LXI H, bassn
        DAD D
        MOV A, M
        OUT NOTE
        RET

; The kick: a square wave falling an octave. Its first tick flashes the
; plasma and fills the beat meter.
kickdrum:
        MVI A, SQUARE
        OUT WAVE
        MVI A, 15
        OUT VOLUME
        MOV A, C
        ORA A
        MVI A, 45
        JZ ki1
        MVI A, 33
ki1:    OUT NOTE
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
        OUT WAVE
        MOV A, C
        ORA A
        MVI A, 13
        JZ sn1
        MVI A, 6
sn1:    OUT VOLUME
        MVI A, 100          ; high enough to play the noise at full speed
        OUT NOTE
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
rows:   DB KICK+BASS, 0, 0, BASS, SNARE, 0, KICK+BASS, 0
        DB KICK+BASS, 0, BASS, 0, SNARE, 0, BASS, 0
lift:   DB 0, 0, 12, 0, 0, 12, 0, 7     ; semitones each row lifts the arpeggio
        DB 0, 12, 0, 7, 12, 0, 0, 12

greets: DB 12, 10
        DB "  +--------------------------------------+", 10
        DB "  |     8 0 8 0   W O R K B E N C H      |", 10
        DB "  |            p r e s e n t s           |", 10
        DB "  |        a 2 MHz cracktro, live        |", 10
        DB "  +--------------------------------------+", 10, 10
        DB "  One voice, no samples: the chords are", 10
        DB "  arpeggios, the drums steal two ticks a row.", 10, 10
        DB "  Greetings to Intel, MITS, Digital Research", 10
        DB "  and every scener who ever squeezed a chord", 10
        DB "  out of a single voice.", 10, 0

; Variables
clock:  DB 0                ; timer ticks, for the plasma's time
tick:   DB TICKS - 1        ; start just before row 0 of bar 0
rown:   DB 15
bar:    DB 3
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
