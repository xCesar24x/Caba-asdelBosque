document.addEventListener('DOMContentLoaded', () => {
    
    // --- Navbar Scroll Effect ---
    const navbar = document.getElementById('navbar');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // --- Intersection Observer for Fade-Up Animations ---
    const fadeElements = document.querySelectorAll('.fade-up');
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };
    
    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    fadeElements.forEach(el => observer.observe(el));

    // --- Initialize Swiper Gallery ---
    const swiper = new Swiper('.gallery-swiper', {
        effect: 'coverflow',
        grabCursor: true,
        centeredSlides: true,
        slidesPerView: 'auto',
        coverflowEffect: {
            rotate: 20,
            stretch: 0,
            depth: 200,
            modifier: 1,
            slideShadows: true,
        },
        loop: true,
        navigation: {
            nextEl: '.swiper-button-next',
            prevEl: '.swiper-button-prev',
        },
        pagination: {
            el: '.swiper-pagination',
            clickable: true,
        },
        autoplay: {
            delay: 3500,
            disableOnInteraction: false,
        }
    });

    // --- Initialize Flatpickr (Calendar) ---
    // Using inline mode to match the visual reference of the booking card
    const datePicker = flatpickr("#datePicker", {
        inline: true,
        mode: "range",
        minDate: "today",
        locale: "es", // Spanish locale
        showMonths: 1,
        disableMobile: true, // Forces custom UI on mobile
        onChange: function(selectedDates, dateStr, instance) {
            // Can be used to validate if check-in and check-out are selected
        }
    });

    // --- Form Submit Logic (Mailto / WhatsApp mapping) ---
    const bookingForm = document.getElementById('bookingForm');
    
    bookingForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const name = document.getElementById('name').value;
        const whatsapp = document.getElementById('whatsapp').value;
        const email = document.getElementById('email').value;
        const guests = document.getElementById('guests').value;
        const selectedDates = datePicker.selectedDates;

        if (selectedDates.length < 2) {
            alert('Por favor, selecciona tu fecha de Check-in y Check-out en el calendario.');
            return;
        }

        // Format dates
        const formatDate = (date) => {
            return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
        };
        const checkIn = formatDate(selectedDates[0]);
        const checkOut = formatDate(selectedDates[1]);

        // Construir el mensaje
        const subject = encodeURIComponent(`Nueva Solicitud de Reserva - ${name}`);
        const body = encodeURIComponent(
            `Hola Cabañas del Bosque,\n\n` +
            `Me gustaría solicitar una reserva con los siguientes detalles:\n\n` +
            `- Nombre: ${name}\n` +
            `- WhatsApp: ${whatsapp}\n` +
            `- Correo: ${email}\n` +
            `- Huéspedes: ${guests}\n` +
            `- Check-in: ${checkIn}\n` +
            `- Check-out: ${checkOut}\n\n` +
            `Por favor, confirmar disponibilidad y siguientes pasos.\n` +
            `Gracias.`
        );

        // Se usa mailto para redirigir al correo (el cliente decide el destinatario final)
        const targetEmail = "Cabanasdelbosque7@gmail.com";
        window.location.href = `mailto:${targetEmail}?subject=${subject}&body=${body}`;
    });
});
