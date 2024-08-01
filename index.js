import express from 'express';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';
import path from 'path';
import { engine } from 'express-handlebars';
import fileUpload from 'express-fileupload';
import db from './db/db.js'
import { v4 as uuid } from 'uuid';

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const secretSignature = "firma_secreta"


app.listen(3000, () => {
    console.log("Servidor escuchando en http://localhost:3000");
});

// Configuración de Handlebars como motor de plantillas
app.engine('.hbs', engine({ extname: '.hbs' }));
app.set('view engine', '.hbs');
app.set('views', path.join(__dirname, 'views'));

// Middlewares
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'archivos')));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(fileUpload({
    limits: { fileSize: 5000000 },
    abortOnLimit: true,
    responseOnLimit: "El peso del archivo que intentas subir supera el límite permitido.",
}));


// VERIFICAR TOKEN
const verifyToken = (req, res, next) => {
    const token = req.query.token; // Obtener el token de los parámetros de la URL

    if (!token) {
        return res.status(401).json({ message: "Acceso denegado. No se proporcionó un token." });
    }

    jwt.verify(token, secretSignature, (err, decoded) => {
        if (err) {
            return res.status(403).json({ message: "Token inválido." });
        }

        req.usuario = decoded; // Almacena la información del usuario decodificada en la solicitud

        next();
    });
};

const verifyAdmin = (req, res, next) => {
    if (!req.usuario || !req.usuario.admin) {
        return res.status(403).json({ message: "Acceso denegado. Solo los administradores pueden acceder a esta ruta." });
    }

    next();
};



//VISTAS PUBLICAS

//Vista inicio de sesión
app.get("/login", (req, res) => {
    res.render("login");
});

//Vista de registro
app.get("/registro", (req, res) => {
    res.render("registro");
});

//Vista principal

app.get(["/", "/home", "/index"], async (req, res) => {
    try {

        let { rows } = await db.query("SELECT id, email, nombre, anos_experiencia, especialidad, foto, estado FROM skaters ORDER BY id");

        let skaters = rows;

        let results = await db.query(`
                 SELECT estado, COUNT(*) cantidad FROM SKATERS
                 GROUP BY estado
                 ORDER BY estado ASC;
        `);

        let aprobados = 0;
        let enRevision = 0;

        let datos = results.rows;

        console.log(datos);

        for (const dato of datos) {
            if (dato.estado) {
                aprobados = dato.cantidad
            } else {
                enRevision = dato.cantidad
            }
        }

        res.render("index", {
            skaters,
            homeView: true,
            aprobados,
            enRevision
        });
    } catch (error) {
        res.render("index", {
            error: "No se han podido cargar los datos en la vista.",
            homeView: true
        });
    }
});

//VISTAS PRIVADAS
//Vista participantes
app.get("/participantes", verifyToken, (req, res) => {
    res.render("participantes");
});

// Vista administrador
app.get("/admin", verifyToken, verifyAdmin, async (req, res) => {
    try {
        // Consulta para obtener todos los skaters
        const { rows } = await db.query("SELECT id, email, nombre, anos_experiencia, especialidad, foto, estado FROM skaters");

        res.render("admin", {
            skaters: rows // Pasa los skaters a la vista
        });
    } catch (error) {
        console.error("Error al obtener skaters:", error);
        res.render("admin", {
            error: "No se pudieron cargar los skaters."
        });
    }
});


//VISTA PAGINAS NO ENCONTRADAS
app.get("/*", (req, res)=> {
    res.render("404");
});

//ENDPOINTS
//Endpoin registro
app.post("/registro", async (req, res) => {
    try {

        let { email, nombre, password, anos_experiencia, especialidad } = req.body;
        let { imagen }  = req.files;

        if(!email || !nombre || !password  || !anos_experiencia || !especialidad || !imagen){
            res.status(400).json({
                message: "Debe proporcionar todos los datos requeridos."
            });
        };

        let foto = `img-${uuid().slice(0,4)}-${imagen.name}`;

        let uploadPath = __dirname + '/public/img/' + foto;

        await db.query("BEGIN");

        let consulta = {
            text: "INSERT INTO skaters VALUES (DEFAULT, $1, $2, $3, $4, $5, $6, DEFAULT) RETURNING id",
            values: [email, nombre, password, anos_experiencia, especialidad, foto]
        }

        let  { rows } = await db.query(consulta);

        let idUsuario = rows[0].id;


        imagen.mv(uploadPath, async function(err) {
            if (err) {

                await db.query("rollback");

                return res.status(500).json({
                    message: "Error al intentar guardar la imagen, vuelva a intentar"
                });
            }

            await db.query("commit");

            res.status(201).json({
                message: "Usuario registrado con éxito con ID: " + idUsuario
            })
        });
        
    } catch (error) {
        console.log(error);
        let message = "Error en proceso de registro, vuelva a intentar";
        let status = 500;

        if(error.code == '23505'){
            message = "Ya existe un usuario registrado con su email";
            status = 400;
        }

        await db.query("rollback");

        return res.status(status).json({
            message
        });
    }

});

//Endpoint inicio sesion

app.post("/login", async (req, res) => {
    try {
        let { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: "Datos insuficientes" });
        }

        let consulta = {
            text: `SELECT S.id, S.nombre, S.email, S.admin AS admin 
                   FROM skaters S
                   WHERE email = $1 AND password = $2`,
            values: [email, password]
        };

        let { rows, rowCount } = await db.query(consulta);
        if (rowCount === 0) {
            return res.status(400).json({ message: "Credenciales inválidas." });
        }

        let usuario = rows[0];

        let token = jwt.sign(usuario, secretSignature, { expiresIn: '5m' });

        res.json({
            message: "Login realizado con éxito",
            token,
            usuario
        });
        console.log(token);

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Error en proceso de login."
        });
    }
});

// Endpoint para actualizar el perfil
app.put('/updateProfile', verifyToken, async (req, res) => {
    try {
        const { nombre, password, anos_experiencia, especialidad } = req.body;

        if (!nombre || !password || !anos_experiencia || !especialidad) {
            return res.status(400).json({ message: 'Faltan datos requeridos.' });
        }

        // Obtener el correo del token decodificado
        const email = req.usuario.email;

        // Lógica para actualizar el perfil en la base de datos
        const updateQuery = {
            text: `UPDATE skaters
                   SET nombre = $1, password = $2, anos_experiencia = $3, especialidad = $4
                   WHERE email = $5`,
            values: [nombre, password, anos_experiencia, especialidad, email]
        };

        await db.query(updateQuery);

        res.json({ message: 'Perfil actualizado con éxito.' });
    } catch (error) {
        res.status(500).json({ message: 'Error al actualizar el perfil.' });
    }
});

// Endpoint para eliminar la cuenta
app.delete('/deleteAccount', verifyToken, async (req, res) => {
    try {
        const email = req.usuario.email;

        if (!email) {
            return res.status(400).json({ message: 'No se encontró el correo electrónico.' });
        }

        const deleteQuery = {
            text: 'DELETE FROM skaters WHERE email = $1',
            values: [email],
        };

        const result = await db.query(deleteQuery);

        console.log('Resultado de la eliminación:', result);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Usuario no encontrado.' });
        }

        res.json({ message: 'Cuenta eliminada con éxito.' });
    } catch (error) {
        console.error('Error al intentar eliminar la cuenta:', error);
        res.status(500).json({ message: 'Error al intentar eliminar la cuenta.' });
    }
});

//ENDPOINT ACTUALIZAR ESTADO (ADMIN)

app.post('/updateEstado', async (req, res) => {
    try {
        const { id, estado } = req.body;

        if (!id || estado === undefined) {
            return res.status(400).json({ message: 'Faltan datos requeridos.' });
        }

        const consulta = {
            text: 'UPDATE skaters SET estado = $1 WHERE id = $2',
            values: [estado === 'true', id]
        };

        await db.query(consulta);

        res.json({ message: 'Estado actualizado con éxito.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error al actualizar el estado.' });
    }
});
