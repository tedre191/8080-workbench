; Snake: every device at once.
;
;   Display   the playfield: 32x32 pixels, memory-mapped at F000h
;   Terminal  W A S D to steer; messages and score
;   Timer     RST 1 drives the game clock
;   Switches  speed: flip more on to go faster (read every step)
;   LEDs      your score in binary
;   Sound     a blip when you eat, a crash when you hit something
;
; While it runs, just type: keys go to the terminal.

STATUS   EQU 10h
DATA     EQU 11h
LEDS     EQU 20h
SWITCHES EQU 21h
TIMER    EQU 30h
NOTE     EQU 40h            ; sound: MIDI note, 0 = off
WAVE     EQU 41h            ; 0 square, 1 triangle, 2 sawtooth, 3 noise
VOLUME   EQU 42h            ; 0-15
VRAM     EQU 0F000h
BODY     EQU 8000h          ; ring buffer: the pixel address of each segment

EMPTY    EQU 0              ; colours (palette indexes)
SNAKEC   EQU 10             ; light green
HEADC    EQU 14             ; yellow
FOODC    EQU 12             ; light red

        ORG 0
        JMP main

        ORG 08h             ; RST 1: the timer ticked
        PUSH PSW
        MVI A, 1
        STA tick
        POP PSW
        EI
        RET

main:   LXI SP, 0E000h
        LXI H, title
        CALL puts
        ; Wait for a key. How long that takes seeds the random generator.
waitkey:
        LHLD seed
        INX H
        SHLD seed
        IN STATUS
        ANI 1
        JZ waitkey
        IN DATA
        MOV A, H            ; the generator must never be zero
        ORA L
        JNZ newgame
        INX H
        SHLD seed

newgame:
        CALL clear
        XRA A
        STA tick
        STA ate
        STA score
        STA taili
        OUT LEDS
        MVI A, 2
        STA headi
        LXI H, 1            ; heading right
        SHLD dir
        SHLD want
        LXI H, VRAM + 16*32 + 8   ; three segments in the middle
        SHLD BODY
        MVI M, SNAKEC
        INX H
        SHLD BODY+2
        MVI M, SNAKEC
        INX H
        SHLD BODY+4
        MVI M, HEADC
        CALL food
        LXI H, gomsg
        CALL puts
        CALL setspeed
        EI

; The main loop sleeps in HLT and does one game step per timer tick.
play:   CALL keys
        DI                  ; check the flag with interrupts off...
        LDA tick
        ORA A
        JNZ dotick
        EI                  ; ...EI only takes effect after HLT starts,
        HLT                 ; so a tick can't slip in between and be missed
        JMP play
dotick: XRA A
        STA tick
        OUT NOTE            ; end the last step's blip, if any
        EI
        CALL random         ; stir the random generator every step
        CALL setspeed
        CALL step
        JZ play

gameover:
        XRA A
        OUT TIMER           ; stop the clock
        LXI H, overmsg
        CALL puts
        LDA score
        CALL putdec
        CALL crash
        LXI H, againmsg
        CALL puts
flush:  IN STATUS           ; forget keys pressed during the crash
        ANI 1
        JZ again
        IN DATA
        JMP flush
again:  IN STATUS
        ANI 1
        JZ again
        IN DATA
        JMP newgame

; Read any steering keys waiting in the terminal.
keys:   IN STATUS
        ANI 1
        RZ
        IN DATA
        ORI 20h             ; accept upper case too
        LXI D, -32          ; movement as a change of pixel address
        CPI 'w'
        JZ steer
        LXI D, 32
        CPI 's'
        JZ steer
        LXI D, -1
        CPI 'a'
        JZ steer
        LXI D, 1
        CPI 'd'
        JNZ keys            ; not a steering key
steer:  LHLD dir            ; opposite directions add up to zero:
        DAD D               ; refuse to reverse into ourselves
        MOV A, H
        ORA L
        JZ keys
        XCHG
        SHLD want
        JMP keys

; Timer period from the switches: 180 ms with none on, down to 53 ms.
setspeed:
        IN SWITCHES
        ORA A               ; clear carry
        RAR                 ; A = switches / 2
        MOV B, A
        MVI A, 180
        SUB B
        OUT TIMER
        RET

; Move one step. Returns Z while alive, NZ when the snake crashed.
step:   LHLD want
        SHLD dir
        XCHG                ; DE = movement
        LDA headi
        CALL load           ; HL = head position
        MOV A, L
        ANI 31
        MOV B, A            ; B = column before moving
        DAD D               ; HL = new head position
        MOV A, H            ; off the top or bottom of video memory?
        ANI 0FCh
        CPI HIGH VRAM
        JNZ dead
        MOV A, L            ; off the left or right edge? Then the column
        ANI 31              ; jumps by 31 instead of changing by 0 or 1
        SUB B
        INR A
        CPI 3
        JNC dead
        MOV A, M            ; read the display to see what we hit
        CPI FOODC
        JZ eat
        ORA A
        JNZ dead            ; ourselves
move:   PUSH H              ; erase the tail
        LDA taili
        CALL load
        MVI M, EMPTY
        LDA taili
        INR A
        STA taili
        POP H
        JMP advance
eat:    MVI A, 1
        STA ate
        LDA taili           ; ring buffer nearly full? Then just move
        MOV C, A
        LDA headi
        SUB C
        CPI 250
        JNC move
advance:
        PUSH H              ; the old head becomes body
        LDA headi
        CALL load
        MVI M, SNAKEC
        LDA headi           ; append the new head to the ring
        INR A
        STA headi
        CALL slot
        POP D
        MOV M, E
        INX H
        MOV M, D
        XCHG
        MVI M, HEADC
        LDA ate
        ORA A
        JZ alive
        MVI A, 84           ; we ate: a blip (C6) until the next step,
        OUT NOTE
        XRA A               ; then score, new food, tell the player
        STA ate
        LDA score
        INR A
        STA score
        OUT LEDS
        CALL food
        LXI H, yum
        CALL puts
        LDA score
        CALL putdec
        MVI A, 10
        OUT DATA
alive:  XRA A               ; Z = alive
        RET
dead:   MVI A, 1
        ORA A               ; NZ = crashed
        RET

; The crash: a burst of low noise that fades out over about half a second.
crash:  MVI A, 3            ; noise
        OUT WAVE
        MVI A, 45           ; low: noise is pitched by how fast it changes
        OUT NOTE
        MVI D, 15           ; volume
cr1:    MOV A, D
        OUT VOLUME
        LXI B, 2800         ; 2800 x 24 T-states: about 34 ms at 2 MHz
cr2:    DCX B
        MOV A, B
        ORA C
        JNZ cr2
        DCR D
        JNZ cr1
        XRA A               ; silence, then back to a full square wave
        OUT NOTE
        OUT WAVE
        MVI A, 15
        OUT VOLUME
        RET

; HL = address of ring slot A.
slot:   MOV L, A
        MVI H, 0
        DAD H
        PUSH D
        LXI D, BODY
        DAD D
        POP D
        RET

; HL = pixel address stored in ring slot A.
load:   CALL slot
        MOV A, M
        INX H
        MOV H, M
        MOV L, A
        RET

; Put food on a random empty pixel.
food:   CALL random
        MOV A, H
        ANI 03h
        ORI HIGH VRAM
        MOV H, A            ; HL = VRAM + (random AND 3FFh)
        MOV A, M
        ORA A
        JNZ food            ; occupied, try again
        MVI M, FOODC
        RET

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

; Clear the display.
clear:  LXI H, VRAM
        LXI B, 32*32
clr1:   MVI M, EMPTY
        INX H
        DCX B
        MOV A, B
        ORA C
        JNZ clr1
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

title:  DB 12, "SNAKE", 10, 10
        DB "Steer with W A S D. Flip switches on to speed up.", 10
        DB "Your score shows on the LEDs.", 10, 10
        DB "Press any key to start.", 10, 0
gomsg:  DB "Go!", 10, 0
yum:    DB "Yum! Score ", 0
overmsg:
        DB "Crash! Final score ", 0
againmsg:
        DB 10, "Press any key to play again.", 10, 0

; Variables
tick:   DB 0                ; set by the timer interrupt
ate:    DB 0
score:  DB 0
headi:  DB 0                ; ring buffer indexes
taili:  DB 0
dir:    DW 1                ; movement applied last step
want:   DW 1                ; movement requested by the keys
seed:   DW 1
