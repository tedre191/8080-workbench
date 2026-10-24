; Simon: watch, listen, repeat.
;
;   Display   four coloured pads
;   Sound     each pad has its own note; a wrong press buzzes
;   Terminal  Q W A S (or 1 2 3 4) press the pads
;   Timer     ticks every 10 ms, to time the notes
;   LEDs      the round you're on
;
; Each round adds a pad to the sequence; repeat it all to go on.
; While it runs, just type: keys go to the terminal.
;
; Play it at 2 MHz or Max. The timer keeps real time at every speed, and at
; 30 Hz and 500 Hz it ticks again before the CPU has finished handling the
; last tick, so the game never gets going.

STATUS   EQU 10h
DATA     EQU 11h
LEDS     EQU 20h
TIMER    EQU 30h
NOTE     EQU 40h            ; sound: MIDI note (69 = A 440 Hz), 0 = off
WAVE     EQU 41h            ; 0 square, 1 triangle, 2 sawtooth, 3 noise
VOLUME   EQU 42h            ; 0-15
VRAM     EQU 0F000h
SIZE     EQU 14             ; pads are 14x14 pixels
MAXLEN   EQU 64             ; win after this many rounds

        ORG 0
        JMP main

        ORG 08h             ; RST 1: the timer ticked. Nothing to do here:
        EI                  ; the tick just wakes the HLT in `wait`.
        RET

main:   LXI SP, 0E000h
        MVI A, 10           ; tick every 10 ms
        OUT TIMER
        EI
        CALL board
        LXI H, title
        CALL puts
        CALL anykey

newgame:
        XRA A
        STA len
        OUT LEDS
        CALL intro
        LXI H, gomsg
        CALL puts

round:  CALL random         ; add a random pad to the sequence
        MOV A, H
        XRA L
        ANI 3
        MOV B, A
        LDA len
        MOV E, A
        MVI D, 0
        LXI H, seq
        DAD D
        MOV M, B
        INR A
        STA len
        OUT LEDS
        MVI E, 60           ; 600 ms to get ready
        CALL wait
        CALL replay
        CALL flush          ; ignore keys pressed while watching
        CALL answer
        JNZ wrong
        LDA len
        CPI MAXLEN
        JNZ round
        LXI H, winmsg
        CALL puts
        CALL intro
        CALL intro
        JMP over

wrong:  PUSH H              ; HL = the pad that was wanted
        CALL buzz
        LXI H, wrongmsg
        CALL puts
        LDA len
        DCR A               ; rounds completed
        CALL putdec
        POP H
        MOV A, M            ; show the right pad
        MVI E, 80
        CALL flash
over:   LXI H, againmsg
        CALL puts
        CALL flush          ; a key pressed during the buzz isn't an answer
        CALL anykey
        JMP newgame

; Play the sequence so far. The notes get shorter as it grows.
replay: LXI H, seq
        LDA len
        MOV C, A
rp1:    PUSH H
        PUSH B
        CALL speed          ; E = note length
        MOV A, M
        CALL flash
        MVI E, 8            ; a short gap between notes
        CALL wait
        POP B
        POP H
        INX H
        DCR C
        JNZ rp1
        RET

; E = how long each note of the sequence lasts, in ticks.
speed:  LDA len
        MVI E, 45
        CPI 6
        RC
        MVI E, 32
        CPI 14
        RC
        MVI E, 22
        RET

; Read the player's answer. Returns Z if it was right, or NZ at the first
; mistake with HL pointing at the pad that was wanted.
answer: LXI H, seq
        LDA len
        MOV C, A
an1:    CALL getpad         ; A = the pad pressed
        CMP M
        RNZ
        PUSH H
        PUSH B
        MVI E, 20
        CALL flash
        POP B
        POP H
        INX H
        DCR C
        JNZ an1
        RET                 ; Z: DCR C reached zero

; Wait for a pad key and return its pad, 0-3, in A. Other keys are ignored.
getpad: PUSH B
        PUSH D
        PUSH H
gp1:    CALL anykey
        ORI 20h             ; lower case (digits stay the same)
        MOV D, A
        LXI H, keys
        MVI B, 0
gp2:    MOV A, M
        ORA A
        JZ gp1              ; not a pad key
        CMP D
        JZ gp3
        INX H
        INR B
        JMP gp2
gp3:    MOV A, B
        ANI 3               ; Q W A S and 1 2 3 4 both give 0-3
        POP H
        POP D
        POP B
        RET

; Light pad A and play its note for E ticks.
flash:  MVI B, 1
        CALL paint
        PUSH PSW
        LXI H, notes
        CALL index
        OUT NOTE
        CALL wait
        XRA A
        OUT NOTE
        POP PSW
        MVI B, 0
        JMP paint

; The wrong-answer buzz: every pad lit and a low sawtooth that fades out.
buzz:   MVI A, 3
bz1:    MVI B, 1
        CALL paint
        DCR A
        JP bz1
        MVI A, 2            ; sawtooth
        OUT WAVE
        MVI A, 31           ; G1, about 49 Hz
        OUT NOTE
        MVI E, 30
        CALL wait
        MVI D, 15
bz2:    MOV A, D            ; fade out over 750 ms
        OUT VOLUME
        MVI E, 5
        CALL wait
        DCR D
        JNZ bz2
        XRA A
        OUT NOTE
        OUT WAVE            ; back to square
        MVI A, 15
        OUT VOLUME
        ; fall through to draw the pads dim

; Draw all four pads, dim.
board:  MVI A, 3
bd1:    MVI B, 0
        CALL paint
        DCR A
        JP bd1
        RET

; A quick run round the pads.
intro:  XRA A
in1:    MVI E, 12
        CALL flash
        INR A
        CPI 4
        JNZ in1
        RET

; Draw pad A, lit if B = 1 or dim if B = 0. Changes only the flags.
paint:  PUSH PSW
        PUSH B
        PUSH D
        PUSH H
        MOV C, A            ; C = pad
        LXI H, dimc
        DCR B
        JNZ pt1
        LXI H, litc
pt1:    CALL index
        MOV E, A            ; E = colour
        MOV A, C            ; HL = the pad's top-left pixel
        ADD A
        MOV C, A
        MVI B, 0
        LXI H, corner
        DAD B
        MOV A, M
        INX H
        MOV H, M
        MOV L, A
        MVI D, SIZE         ; rows
pt2:    MVI B, SIZE         ; pixels in a row
pt3:    MOV M, E
        INX H
        DCR B
        JNZ pt3
        LXI B, 32 - SIZE    ; on to the next row
        DAD B
        DCR D
        JNZ pt2
        POP H
        POP D
        POP B
        POP PSW
        RET

; A = the byte at HL + A. Changes HL.
index:  ADD L
        MOV L, A
        MVI A, 0            ; MVI leaves the carry for ADC
        ADC H
        MOV H, A
        MOV A, M
        RET

; Wait E ticks (E > 0). Each tick's interrupt wakes the HLT.
wait:   HLT
        DCR E
        JNZ wait
        RET

; Wait for any key and return it in A. The wait stirs the random numbers.
anykey: CALL random
        IN STATUS
        ANI 1
        JZ anykey
        IN DATA
        RET

; Throw away any keys waiting.
flush:  IN STATUS
        ANI 1
        RZ
        IN DATA
        JMP flush

; 16-bit Galois LFSR: HL = next pseudo-random number.
random: LHLD seed
        MOV A, H
        ORA A               ; clear carry
        RAR
        MOV H, A
        MOV A, L
        RAR
        MOV L, A
        JNC rnd1
        MOV A, H
        XRI 0B4h
        MOV H, A
rnd1:   SHLD seed
        RET

; Print the zero-terminated string at HL.
puts:   MOV A, M
        ORA A
        RZ
        OUT DATA
        INX H
        JMP puts

; Print A as an unsigned decimal number.
putdec: PUSH B
        PUSH D
        MVI B, 0            ; B = 1 once a digit has been printed
        MVI C, 100
        CALL digit
        MVI C, 10
        CALL digit
        ADI '0'
        OUT DATA
        POP D
        POP B
        RET

; Print A / C as one digit (skipping leading zeros); return A mod C.
digit:  MVI E, '0' - 1
dg1:    INR E
        SUB C
        JNC dg1
        ADD C
        MOV D, A
        MOV A, E
        CPI '0'
        JNZ dg2
        MOV A, B
        ORA A
        JZ dg3
dg2:    MOV A, E
        OUT DATA
        MVI B, 1
dg3:    MOV A, D
        RET

; The pads, in key order: top left, top right, bottom left, bottom right.
corner: DW VRAM + 1*32 + 1, VRAM + 1*32 + 17, VRAM + 17*32 + 1, VRAM + 17*32 + 17
dimc:   DB 2, 4, 6, 1       ; green, red, brown, blue
litc:   DB 10, 12, 14, 9    ; and their bright versions
notes:  DB 64, 69, 61, 52   ; E4, A4, C#4, E3: an A major chord
keys:   DB "qwas1234", 0

title:  DB 12, "SIMON", 10, 10
        DB "Watch the pads, listen, then repeat the sequence:", 10, 10
        DB "    Q W    or    1 2", 10
        DB "    A S          3 4", 10, 10
        DB "The LEDs show the round. Press any key to start.", 10, 0
gomsg:  DB "Go!", 10, 0
wrongmsg:
        DB "Wrong! Rounds completed: ", 0
winmsg: DB "You remembered all 64. You win!", 10, 0
againmsg:
        DB 10, "Press any key to play again.", 10, 0

; Variables
seed:   DW 1                ; never zero
len:    DB 0                ; the sequence's length
seq:    DS MAXLEN           ; the pads, 0-3
